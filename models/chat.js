const { Schema, model } = require("mongoose");
const postSchema = new Schema({
  id: String,
  username: String,
  value: String,
  isImage: Boolean,
  timestamp: String,
  color: String,
});
module.exports = { mainModel: model("mains", postSchema) };
