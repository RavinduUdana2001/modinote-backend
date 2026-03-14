const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const multer = require("multer");
const auth = require("../middleware/auth.middleware");
const { voiceTempDir } = require("../config/uploads");
const {
  AUTO_LANGUAGE_CODE,
  ENGLISH_LANGUAGE_CODE,
  SarvamServiceError,
  transcribeAudio,
} = require("../services/sarvam.service");

const router = express.Router();

const maxVoiceFileBytes =
  Number(process.env.MAX_VOICE_FILE_MB || 25) * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, voiceTempDir);
    },
    filename(req, file, cb) {
      const extension = path.extname(file.originalname || ".wav") || ".wav";
      const baseName = path
        .basename(file.originalname || "recording.wav", extension)
        .replace(/[^a-zA-Z0-9-_]/g, "-");
      cb(null, `${Date.now()}-${baseName}${extension}`);
    },
  }),
  limits: {
    fileSize: maxVoiceFileBytes,
  },
  fileFilter(req, file, cb) {
    if (file.mimetype?.startsWith("audio/")) {
      return cb(null, true);
    }

    return cb(
      new SarvamServiceError(
        "Only audio uploads are supported for transcription.",
        400,
      ),
    );
  },
});

router.post(
  "/transcribe",
  auth,
  upload.single("audio"),
  async (req, res, next) => {
    const tempFilePath = req.file?.path;

    try {
      if (!req.file?.path) {
        throw new SarvamServiceError("Audio file is required.", 400);
      }

      const mode = req.body?.mode || "translate";
      const captureMode = req.body?.captureMode || "dictate";
      const durationSeconds = Number(req.body?.durationSeconds || 0) || null;
      const enableDiarization =
        req.body?.enableDiarization === "true" || captureMode === "transcribe";
      const numSpeakers = Number(req.body?.numSpeakers || 2) || 2;
      const preferredLanguageCode =
        req.body?.preferredLanguageCode ||
        (captureMode === "dictate"
          ? ENGLISH_LANGUAGE_CODE
          : AUTO_LANGUAGE_CODE);
      const result = await transcribeAudio({
        filePath: req.file.path,
        filename: req.file.originalname || "recording.wav",
        mimeType: req.file.mimetype || "audio/wav",
        mode,
        preferredLanguageCode,
        captureMode,
        durationSeconds,
        enableDiarization,
        numSpeakers,
      });

      return res.json({
        message: "Transcription completed successfully.",
        transcript: result.transcript,
        languageCode: result.languageCode,
        requestId: result.requestId,
        timestamps: result.timestamps || null,
        speakerEntries: result.diarizedEntries || [],
        diarizationEnabled: Boolean(result.diarizationEnabled),
        durationSeconds,
        mode: result.requestMode || mode,
        requestLanguageCode: result.requestLanguageCode || preferredLanguageCode,
        jobId: result.jobId || null,
      });
    } catch (error) {
      return next(error);
    } finally {
      if (tempFilePath) {
        try {
          await fs.unlink(tempFilePath);
        } catch {
          // Ignore temp file cleanup errors.
        }
      }
    }
  },
);

module.exports = router;
