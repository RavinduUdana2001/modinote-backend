const path = require("path");
const fs = require("fs");

const uploadsDir = path.resolve(__dirname, "../../uploads");
const runtimeDir = path.resolve(__dirname, "../../runtime");
const voiceTempDir = path.join(runtimeDir, "voice-temp");
const legacyVoiceTempDir = path.join(uploadsDir, "voice-temp");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function clearDirectoryContents(dirPath) {
  if (!fs.existsSync(dirPath)) return;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      fs.rmSync(entryPath, { recursive: true, force: true });
      continue;
    }

    fs.rmSync(entryPath, { force: true });
  }
}

function prepareUploadDirectories() {
  ensureDir(uploadsDir);
  ensureDir(runtimeDir);
  ensureDir(voiceTempDir);
}

function cleanupVoiceTempDirectories() {
  clearDirectoryContents(voiceTempDir);
  clearDirectoryContents(legacyVoiceTempDir);
}

prepareUploadDirectories();

module.exports = {
  uploadsDir,
  voiceTempDir,
  cleanupVoiceTempDirectories,
};
