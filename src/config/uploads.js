const path = require("path");
const fs = require("fs");

const uploadsDir = path.resolve(__dirname, "../../uploads");
const voiceTempDir = path.join(uploadsDir, "voice-temp");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(voiceTempDir)) {
  fs.mkdirSync(voiceTempDir, { recursive: true });
}

module.exports = {
  uploadsDir,
  voiceTempDir,
};
