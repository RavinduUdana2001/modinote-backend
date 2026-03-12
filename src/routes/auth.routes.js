const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const auth = require("../middleware/auth.middleware");
const { createAndSendOtp } = require("../utils/otp");
const { createAndSendPendingOtp } = require("../utils/pendingOtp");
const crypto = require("crypto");
const { sendResetOtpEmail } = require("../utils/sendResetOtpEmail");
const generateUniqueSupportRef = require("../utils/generateSupportRef");

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

function generateOtp6() {
  return String(crypto.randomInt(100000, 999999));
}

router.post("/signup", async (req, res) => {
  try {
    const { name, email, phone, password, privacy_accepted } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ message: "Name, email and password are required." });
    }

    if (password.length < 8) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters." });
    }

    const emailLower = email.toLowerCase().trim();

    const existing = await pool.query("SELECT id, email_verified FROM users WHERE email=$1", [
      emailLower,
    ]);

    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      if (user.email_verified) {
        return res.status(409).json({ message: "Email already registered." });
      }

      await createAndSendOtp(user.id, emailLower);
      return res.status(200).json({ message: "OTP resent to your email." });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const privacyAccepted = !!privacy_accepted;

    const pendingRes = await pool.query(
      "SELECT id FROM pending_users WHERE email=$1",
      [emailLower]
    );

    if (pendingRes.rows.length > 0) {
      const pendingId = pendingRes.rows[0].id;
      await pool.query(
        `
        UPDATE pending_users
        SET name = $1,
            phone = $2,
            password_hash = $3,
            privacy_accepted = $4,
            privacy_accepted_at = CASE WHEN $4 THEN COALESCE(privacy_accepted_at, NOW()) ELSE NULL END,
            updated_at = NOW()
        WHERE id = $5
        `,
        [
          name.trim(),
          phone ? phone.trim() : null,
          password_hash,
          privacyAccepted,
          pendingId,
        ]
      );

      await createAndSendPendingOtp(pendingId, emailLower);

      return res.status(200).json({
        message: "OTP resent to your email",
      });
    }

    const result = await pool.query(
      `INSERT INTO pending_users (name, email, phone, password_hash, privacy_accepted, privacy_accepted_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NOW() ELSE NULL END)
       RETURNING id, name, email, phone, created_at`,
      [
        name.trim(),
        emailLower,
        phone ? phone.trim() : null,
        password_hash,
        privacyAccepted,
      ]
    );

    const pendingUser = result.rows[0];

    await createAndSendPendingOtp(pendingUser.id, pendingUser.email);

    return res.status(201).json({
      message: "OTP sent to your email",
      user: {
        name: pendingUser.name,
        email: pendingUser.email,
        phone: pendingUser.phone,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/verify-email", async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ message: "Email and code required." });
    }

    const emailLower = email.toLowerCase().trim();

    const userRes = await pool.query(
      `SELECT id, name, email, phone, support_ref, email_verified,
              onboarding_completed, privacy_accepted
       FROM users
       WHERE email=$1`,
      [emailLower]
    );

    if (userRes.rows.length > 0) {
      const user = userRes.rows[0];

      if (user.email_verified) {
        const token = signToken(user);
        return res.json({
          token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            support_ref: user.support_ref,
            onboarding_completed: user.onboarding_completed,
            privacy_accepted: user.privacy_accepted,
          },
        });
      }

      const otpRes = await pool.query(
        `SELECT id, code_hash, expires_at, used, attempts
         FROM email_otps
         WHERE user_id=$1
         ORDER BY created_at DESC
         LIMIT 1`,
        [user.id]
      );

      if (otpRes.rows.length === 0) {
        return res.status(400).json({ message: "Invalid code." });
      }

      const otpRow = otpRes.rows[0];

      if (otpRow.used) {
        return res.status(400).json({ message: "Code already used. Please resend OTP." });
      }

      if (otpRow.attempts >= 5) {
        return res.status(400).json({ message: "Too many attempts. Please resend OTP." });
      }

      if (new Date() > new Date(otpRow.expires_at)) {
        return res.status(400).json({ message: "Code expired. Please resend OTP." });
      }

      await pool.query("UPDATE email_otps SET attempts = attempts + 1 WHERE id=$1", [
        otpRow.id,
      ]);

      const ok = await bcrypt.compare(String(code).trim(), otpRow.code_hash);
      if (!ok) {
        return res.status(400).json({ message: "Invalid code." });
      }

      await pool.query("UPDATE email_otps SET used=true WHERE id=$1", [otpRow.id]);
      await pool.query("UPDATE users SET email_verified=true WHERE id=$1", [user.id]);

      const token = signToken(user);

      return res.json({
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          support_ref: user.support_ref,
          onboarding_completed: user.onboarding_completed,
          privacy_accepted: user.privacy_accepted,
        },
      });
    }

    const pendingRes = await pool.query(
      `SELECT id, name, email, phone, password_hash, privacy_accepted, privacy_accepted_at
       FROM pending_users
       WHERE email=$1`,
      [emailLower]
    );

    if (pendingRes.rows.length === 0) {
      return res.status(400).json({ message: "Invalid code." });
    }

    const pendingUser = pendingRes.rows[0];

    const otpRes = await pool.query(
      `SELECT id, code_hash, expires_at, used, attempts
       FROM pending_email_otps
       WHERE pending_user_id=$1
       ORDER BY created_at DESC
       LIMIT 1`,
      [pendingUser.id]
    );

    if (otpRes.rows.length === 0) {
      return res.status(400).json({ message: "Invalid code." });
    }

    const otpRow = otpRes.rows[0];

    if (otpRow.used) {
      return res.status(400).json({ message: "Code already used. Please resend OTP." });
    }

    if (otpRow.attempts >= 5) {
      return res.status(400).json({ message: "Too many attempts. Please resend OTP." });
    }

    if (new Date() > new Date(otpRow.expires_at)) {
      return res.status(400).json({ message: "Code expired. Please resend OTP." });
    }

    await pool.query("UPDATE pending_email_otps SET attempts = attempts + 1 WHERE id=$1", [
      otpRow.id,
    ]);

    const ok = await bcrypt.compare(String(code).trim(), otpRow.code_hash);
    if (!ok) {
      return res.status(400).json({ message: "Invalid code." });
    }

    await pool.query("UPDATE pending_email_otps SET used=true WHERE id=$1", [otpRow.id]);

    const supportRef = await generateUniqueSupportRef();

    const createRes = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, support_ref, email_verified, privacy_accepted, privacy_accepted_at)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7)
       RETURNING id, name, email, phone, support_ref, email_verified,
                 onboarding_completed, privacy_accepted`,
      [
        pendingUser.name,
        pendingUser.email,
        pendingUser.phone,
        pendingUser.password_hash,
        supportRef,
        !!pendingUser.privacy_accepted,
        pendingUser.privacy_accepted_at,
      ]
    );

    await pool.query("DELETE FROM pending_users WHERE id=$1", [pendingUser.id]);

    const user = createRes.rows[0];
    const token = signToken(user);

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        support_ref: user.support_ref,
        onboarding_completed: user.onboarding_completed,
        privacy_accepted: user.privacy_accepted,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required." });

    const emailLower = email.toLowerCase().trim();

    const userRes = await pool.query(
      "SELECT id, email_verified FROM users WHERE email=$1",
      [emailLower]
    );

    if (userRes.rows.length > 0) {
      const user = userRes.rows[0];

      if (user.email_verified) {
        return res.json({ message: "Email already verified." });
      }

      await createAndSendOtp(user.id, emailLower);
      return res.json({ message: "OTP resent." });
    }

    const pendingRes = await pool.query(
      "SELECT id FROM pending_users WHERE email=$1",
      [emailLower]
    );

    if (pendingRes.rows.length === 0) {
      return res.json({ message: "If the email exists, OTP was sent." });
    }

    await createAndSendPendingOtp(pendingRes.rows[0].id, emailLower);
    return res.json({ message: "OTP resent." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const emailLower = email.toLowerCase().trim();

    const result = await pool.query(
      `SELECT id, name, email, phone, support_ref, password_hash, email_verified,
              onboarding_completed, privacy_accepted
       FROM users
       WHERE email=$1`,
      [emailLower]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const user = result.rows[0];

    if (!user.email_verified) {
      return res.status(403).json({ message: "Please verify your email first." });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const token = signToken(user);

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        support_ref: user.support_ref,
        onboarding_completed: user.onboarding_completed,
        privacy_accepted: user.privacy_accepted,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required." });

    const emailLower = email.toLowerCase().trim();
    const userRes = await pool.query("SELECT id, email FROM users WHERE email=$1", [emailLower]);

    if (userRes.rows.length === 0) {
      return res.json({ message: "If an account exists, an OTP was sent to your email." });
    }

    const user = userRes.rows[0];
    const otp = generateOtp6();
    const code_hash = await bcrypt.hash(otp, 10);

    const mins = Number(process.env.OTP_EXPIRES_MIN || 10);
    const expires_at = new Date(Date.now() + mins * 60 * 1000);

    await pool.query(
      `INSERT INTO password_reset_otps (user_id, code_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, code_hash, expires_at]
    );

    await sendResetOtpEmail(user.email, otp);

    return res.json({ message: "If an account exists, an OTP was sent to your email." });
  } catch (err) {
    console.error("forgot-password error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/resend-reset-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required." });

    const emailLower = email.toLowerCase().trim();
    const userRes = await pool.query("SELECT id, email FROM users WHERE email=$1", [emailLower]);

    if (userRes.rows.length === 0) {
      return res.json({ message: "If an account exists, an OTP was sent to your email." });
    }

    const user = userRes.rows[0];
    const otp = generateOtp6();
    const code_hash = await bcrypt.hash(otp, 10);

    const mins = Number(process.env.OTP_EXPIRES_MIN || 10);
    const expires_at = new Date(Date.now() + mins * 60 * 1000);

    await pool.query(
      `INSERT INTO password_reset_otps (user_id, code_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, code_hash, expires_at]
    );

    await sendResetOtpEmail(user.email, otp);

    return res.json({ message: "If an account exists, an OTP was sent to your email." });
  } catch (err) {
    console.error("resend-reset-otp error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: "Email, code and newPassword are required." });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters." });
    }

    const emailLower = email.toLowerCase().trim();

    const userRes = await pool.query(
      "SELECT id, password_hash FROM users WHERE email=$1",
      [emailLower]
    );

    if (userRes.rows.length === 0) {
      return res.status(400).json({ message: "Invalid code." });
    }

    const userId = userRes.rows[0].id;
    const currentHash = userRes.rows[0].password_hash;

    const otpRes = await pool.query(
      `SELECT id, code_hash, expires_at, used, attempts
       FROM password_reset_otps
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (otpRes.rows.length === 0) {
      return res.status(400).json({ message: "Invalid code." });
    }

    const row = otpRes.rows[0];

    if (row.used) return res.status(400).json({ message: "Code already used. Please resend OTP." });
    if (row.attempts >= 5) return res.status(400).json({ message: "Too many attempts. Please resend OTP." });
    if (new Date() > new Date(row.expires_at)) {
      return res.status(400).json({ message: "Code expired. Please resend OTP." });
    }

    await pool.query("UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id=$1", [row.id]);

    const ok = await bcrypt.compare(String(code).trim(), row.code_hash);
    if (!ok) return res.status(400).json({ message: "Invalid code." });

    const sameAsOld = await bcrypt.compare(String(newPassword), currentHash);
    if (sameAsOld) {
      return res.status(400).json({
        message: "New password must be different from your current password.",
      });
    }

    const password_hash = await bcrypt.hash(String(newPassword), 10);
    await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [password_hash, userId]);
    await pool.query("UPDATE password_reset_otps SET used=true WHERE id=$1", [row.id]);

    return res.json({ message: "Password updated successfully." });
  } catch (err) {
    console.error("reset-password error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/me", auth, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT id, name, email, phone, support_ref, email_verified, created_at
       FROM users
       WHERE id=$1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    return res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;

