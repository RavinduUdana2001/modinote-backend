const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pool = require("../db");
const auth = require("../middleware/auth.middleware");
const { uploadsDir } = require("../config/uploads");

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || ".jpg");
    cb(null, `user-${req.user.userId}-${Date.now()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
  if (!allowed.includes(file.mimetype)) {
    return cb(new Error("Only JPG, PNG, and WEBP files are allowed."));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 3 * 1024 * 1024,
  },
});

function extractLocalUploadPath(imageUrl) {
  if (!imageUrl) return null;

  try {
    const fileName = path.basename(imageUrl);
    if (!fileName) return null;

    if (!fileName.startsWith("user-")) return null;

    return path.join(uploadsDir, fileName);
  } catch (error) {
    return null;
  }
}

function deleteFileIfExists(filePath) {
  if (!filePath) return;

  fs.access(filePath, fs.constants.F_OK, (accessErr) => {
    if (accessErr) return;

    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr) {
        console.error("Failed to delete old profile image:", unlinkErr.message);
      }
    });
  });
}

router.get("/me", auth, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `
      SELECT
        id,
        name,
        email,
        phone,
        support_ref,
        email_verified,
        onboarding_completed,
        profile_image_url,
        privacy_accepted,
        privacy_accepted_at,
        created_at,
        updated_at
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    return res.json({
      user: result.rows[0],
    });
  } catch (error) {
    console.error("GET /profile/me error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.put("/update", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, phone } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "Name is required." });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET
        name = $1,
        phone = $2,
        updated_at = NOW()
      WHERE id = $3
      RETURNING
        id,
        name,
        email,
        phone,
        support_ref,
        email_verified,
        onboarding_completed,
        profile_image_url,
        privacy_accepted,
        privacy_accepted_at,
        created_at,
        updated_at
      `,
      [String(name).trim(), phone ? String(phone).trim() : null, userId]
    );

    return res.json({
      message: "Profile updated successfully.",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("PUT /profile/update error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/image", auth, upload.single("image"), async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!req.file) {
      return res.status(400).json({ message: "Image file is required." });
    }

    const currentUserRes = await pool.query(
      `
      SELECT profile_image_url
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

    if (currentUserRes.rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    const oldImageUrl = currentUserRes.rows[0].profile_image_url || null;

    const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;

    const result = await pool.query(
      `
      UPDATE users
      SET
        profile_image_url = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING
        id,
        name,
        email,
        phone,
        support_ref,
        email_verified,
        onboarding_completed,
        profile_image_url,
        privacy_accepted,
        privacy_accepted_at,
        created_at,
        updated_at
      `,
      [imageUrl, userId]
    );

    const oldFilePath = extractLocalUploadPath(oldImageUrl);

    if (oldFilePath) {
      deleteFileIfExists(oldFilePath);
    }

    return res.json({
      message: "Profile image uploaded successfully.",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("POST /profile/image error:", error);
    return res.status(500).json({
      message: error.message || "Image upload failed.",
    });
  }
});

router.put("/onboarding", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, phone, agree } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "Name is required." });
    }

    if (!agree) {
      return res.status(400).json({ message: "Privacy Policy acceptance is required." });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET
        name = $1,
        phone = $2,
        privacy_accepted = $3,
        privacy_accepted_at = CASE WHEN $3 THEN COALESCE(privacy_accepted_at, NOW()) ELSE NULL END,
        onboarding_completed = true,
        updated_at = NOW()
      WHERE id = $4
      RETURNING
        id,
        name,
        email,
        phone,
        support_ref,
        email_verified,
        onboarding_completed,
        profile_image_url,
        privacy_accepted,
        privacy_accepted_at,
        created_at,
        updated_at
      `,
      [
        String(name).trim(),
        phone ? String(phone).trim() : null,
        !!agree,
        userId,
      ]
    );

    return res.json({
      message: "Onboarding completed.",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("PUT /profile/onboarding error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
