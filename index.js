const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const passport = require("passport");
const session = require("express-session");
const bodyParser = require("body-parser"); // Impor body-parser
const { mainModel } = require("./models/chat");
const { userModel } = require("./models/user");
const { DateTime } = require("luxon");

const mongoose = require("mongoose");
require("dotenv").config();

mongoose
  .connect(process.env.mongo, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000, // Increase the server selection timeout
  })
  .then(() => {
    var users = []; // Array untuk menyimpan data pengguna yang mendaftar
    var chat = [];
    mainModel.find({}, null).then((docs) => {
      chat = docs.slice(-10);
      http.listen(3000, () => {
        console.log("Server is running on http://localhost:3000");
        function getRandomColor() {
          const colors = [
            "#f44336",
            "#254336",
            "green",
            "#ff5722",
            "#5865f2",
            "#ffc0cb",
            "#46beff",
          ];
          return colors[Math.floor(Math.random() * colors.length)];
        }

        async function checkAndUpdateColors() {
          try {
            // Membuat query untuk menemukan pengguna yang tidak memiliki warna
            const query = { color: { $exists: false } };

            // Mendapatkan semua pengguna yang tidak memiliki warna
            const usersWithoutColor = await userModel.find(query);

            // Menentukan pembaruan yang harus dilakukan untuk setiap pengguna
            const updatePromises = usersWithoutColor.map(async (user) => {
              const randomColor = getRandomColor();
              user.color = randomColor;
              await user.save(); // Simpan perubahan ke MongoDB
            });

            // Menunggu semua pembaruan selesai
            await Promise.all(updatePromises);

            console.log(
              `${usersWithoutColor.length} colors checked and updated successfully`
            );

            // Ambil ulang data pengguna setelah pembaruan selesai
            const updatedUsers = await userModel.find({});
            users = updatedUsers;
          } catch (error) {
            console.error("Error checking and updating colors:", error);
          }
        }

        // Panggil fungsi untuk memeriksa dan memperbarui warna ketika server dimulai
        checkAndUpdateColors();
        // Konfigurasi Express session
        app.use(
          session({
            secret: "your-secret-key",
            resave: false,
            saveUninitialized: true,
          })
        );

        app.use(passport.initialize());
        app.use(passport.session());
        app.use(bodyParser.urlencoded({ extended: false }));
        app.use(express.json({ limit: "50mb" })); // Adjust the limit accordingly
        app.use(express.urlencoded({ limit: "50mb", extended: true })); // Adjust the limit accordingly
        app.use(express.static("public"));
        app.set("view engine", "ejs");

        app.get("/", (req, res) => {
          res.render("login");
        });

        app.get("/signup", (req, res) => {
          res.render("signup");
        });

        app.get("/chat", async (req, res) => {
          res.render("chat", {
            chat: chat.slice(-10),
          });
        });

        passport.serializeUser(function (user, cb) {
          cb(null, user);
        });

        passport.deserializeUser(function (obj, cb) {
          cb(null, obj);
        });

        // Google OAuth configuration
        const GoogleStrategy = require("passport-google-oauth2").Strategy;

        passport.use(
          new GoogleStrategy(
            {
              clientID: process.env.clientId,
              clientSecret: process.env.clientSecret,
              callbackURL: process.env.callbackURL,
            },
            (accessToken, refreshToken, profile, done) => {
              // Save user profile data in the 'userProfile' object (you can save it in a database)
              userProfile[profile.id] = profile;
              return done(null, profile);
            }
          )
        );

        app.get(
          "/auth/google",
          passport.authenticate("google", { scope: ["profile", "email"] })
        );

        app.get(
          "/auth/google/callback",
          passport.authenticate("google", {
            failureRedirect: "/",
          }),
          (req, res) => {
            // Berhasil masuk, redirect ke halaman chat
            res.redirect("/chat");
          }
        );

        // Implementasi signup
        app.post("/signup", async (req, res) => {
          const { username, password } = req.body;

          // Periksa apakah username sudah ada
          const isUsernameTaken = users.some(
            (user) => user.username === username
          );

          if (isUsernameTaken) {
            return res.send(
              "Maaf, username tersebut sudah ada. Anda bisa menambahkan angka atau kata lain untuk membuat username Anda unik. <a href='/signup' > Kembali </a>"
            );
          }
          await userModel.create({
            id: username,
            username: username,
            password: password,
            color: getRandomColor(),
          });
          // Jika username belum ada, simpan data pengguna yang mendaftar dalam objek users
          users.push({
            id: username,
            username: username,
            password: password,
            color: getRandomColor(),
          });

          return res.redirect("/");
        });

        // Implementasi login
        app.post("/login", (req, res) => {
          const { username, password } = req.body;

          // Cek apakah pengguna sudah terdaftar dan password sesuai
          const userIndex = users.findIndex(
            (u) => u.username === username && u.password === password
          );
          if (userIndex !== -1) {
            // Jika pengguna ditemukan, kirim data pengguna ke halaman "success"
            return res.render("success", {
              user: users[userIndex].username,
            });
          } else {
            // Redirect ke halaman login dengan pesan kesalahan
            return res.send("Password Salah");
          }
        });

        const messageInfo = {};
        const badWordsString = process.env.katakasar;
        const badword = badWordsString.split(",");
        io.on("connection", (socket) => {
          messageInfo[0] = {
            lastUsername: "",
            lastMessage: chat[chat.length - 1].value,
          };
          function giveMessageInfo(user, lastMessage) {
            // Mendapatkan ID klien yang terkait dengan socket
            const clientId = socket.id;
            const timestamp = DateTime.now()
              .setZone("Asia/Jakarta")
              .toLocaleString(DateTime.TIME_SIMPLE);
            // Inisialisasi informasi pesan untuk klien ini jika belum ada
            if (!messageInfo[clientId]) {
              messageInfo[clientId] = {
                count: 0,
                lastSent: Date.now() - 1000, // Inisialisasi dengan waktu 2 detik yang lalu,
                warn: false,
                lastMessage: "",
              };
            }
            const containsBadWord = badword.some((word) => {
              const regex = new RegExp(`\\b${word}\\b`, "i");
              return regex.test(lastMessage);
            });
            if (containsBadWord) {
              // Perbarui informasi pesan untuk klien ini
              messageInfo[clientId].count++;
              messageInfo[clientId].lastSent = Date.now();
              messageInfo[clientId].lastMessage = lastMessage;
              messageInfo[0].lastMessage = lastMessage;
              // Kirim pesan ke klien bahwa pesan terlalu sering
              if (!messageInfo[clientId].warn) {
                io.emit("chat message", {
                  username: "Atmin Marah",
                  color: "red",
                  value: `@${user} JANGAN TOXIC WOY`,
                  timestamp,
                });
                io.emit("chat message", {
                  username: "Atmin Marah",
                  color: "red",
                  value: `https://media.tenor.com/Lbi95-I1Vw0AAAAi/menhera-chan-annoyed.gif`,
                  timestamp,
                });

                messageInfo[clientId].warn = true;
              }
              return true; // Keluar dari fungsi untuk menghentikan pengiriman pesan lebih lanjut
            }
            if (Date.now() - messageInfo[clientId].lastSent >= 2000) {
              messageInfo[clientId].count = 0;
              messageInfo[clientId].warn = false;
            }
            // Mengecek apakah sudah melewati batas waktu 2 detik sejak pesan terakhir
            if (
              lastMessage.length > 169 || // Jika panjang pesan lebih dari 169 karakter
              (Date.now() - messageInfo[clientId].lastSent < 2000 &&
                (messageInfo[clientId].count >= 5 ||
                  messageInfo[clientId].lastMessage === lastMessage ||
                  messageInfo[clientId].lastMessage ===
                    messageInfo[0].lastMessage))
            ) {
              // Perbarui informasi pesan untuk klien ini
              messageInfo[clientId].count++;
              messageInfo[clientId].lastSent = Date.now();
              messageInfo[clientId].lastMessage = lastMessage;
              messageInfo[0].lastMessage = lastMessage;
              // Kirim pesan ke klien bahwa pesan terlalu sering
              if (!messageInfo[clientId].warn) {
                io.emit("chat message", {
                  username: "Atmin Marah",
                  color: "red",
                  value: `@${user} JANGAN SPAM PLS`,
                  timestamp,
                });
                io.emit("chat message", {
                  username: "Atmin Marah",
                  color: "red",
                  value: `https://pm1.aminoapps.com/6382/91d1e56321329121009aedec0620e43d4c8437ea_00.jpg`,
                  timestamp,
                });

                messageInfo[clientId].warn = true;
              }
              return true; // Keluar dari fungsi untuk menghentikan pengiriman pesan lebih lanjut
            }

            // Perbarui informasi pesan untuk klien ini
            messageInfo[clientId].count++;
            messageInfo[clientId].lastSent = Date.now();
            messageInfo[clientId].lastMessage = lastMessage;
            messageInfo[0].lastMessage = lastMessage;

            return false;
          }
          socket.on("chat message", async (msg) => {
            const checkSpam = giveMessageInfo(msg.username, msg.value);
            if (checkSpam) return;
            const timestamp = DateTime.now()
              .setZone("Asia/Jakarta")
              .toLocaleString(DateTime.TIME_SIMPLE);

            // Ambil warna pengguna dari MongoDB menggunakan username
            const user = await userModel.findOne({ username: msg.username });
            const userColor = user ? user.color : null;

            // Tambahkan properti color ke objek msg
            const msgWithColor = { ...msg, timestamp, color: userColor };

            // Kirim pesan dengan properti color
            io.emit("chat message", msgWithColor);

            await mainModel.create({
              id: msg.username,
              username: msg.username,
              value: msg.value,
              timestamp,
              color: userColor,
            });

            chat.push({
              username: msg.username,
              value: msg.value,
              timestamp,
              color: userColor,
            });
          });

          socket.on("image", async (data) => {
            giveMessageInfo();
            const timestamp = DateTime.now()
              .setZone("Asia/Jakarta")
              .toLocaleString(DateTime.TIME_SIMPLE);

            // Dapatkan warna pengguna dari users object
            const user = await userModel.findOne({ username: data.username });
            const userColor = user ? user.color : null;

            // Tambahkan properti color ke objek msg
            const msgWithColor = { ...data, timestamp, color: userColor };

            // Kirim pesan dengan properti color
            io.emit("image", msgWithColor);

            chat.push({
              id: data.username,
              username: data.username,
              value: data.imageData,
              isImage: true,
              timestamp,
              color: userColor, // Tambahkan warna ke chat array
            });

            // Simpan data gambar ke database atau lakukan operasi lain yang diperlukan
            await mainModel.create({
              id: data.username,
              username: data.username,
              value: data.imageData,
              isImage: true,
              timestamp,
              color: userColor, // Tambahkan warna ke data yang disimpan di database
            });
          });
        });
      });
    });
  })
  .catch((error) => {
    console.error("Database connection error:", error);
  });
