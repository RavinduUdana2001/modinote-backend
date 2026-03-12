const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const auth = require("../middleware/auth.middleware");
const { sendMail } = require("../utils/mailer");

const router = express.Router();

router.put("/change-password", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        message: "All password fields are required.",
      });
    }

    if (String(newPassword).length < 8) {
      return res.status(400).json({
        message: "New password must be at least 8 characters. Use letters and numbers.",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        message: "New password and confirm password do not match.",
      });
    }

    const userRes = await pool.query(
      `SELECT id, password_hash FROM users WHERE id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    const user = userRes.rows[0];

    const isCurrentValid = await bcrypt.compare(
      currentPassword,
      user.password_hash
    );

    if (!isCurrentValid) {
      return res.status(400).json({
        message: "Current password is incorrect.",
      });
    }

    const isSamePassword = await bcrypt.compare(
      newPassword,
      user.password_hash
    );

    if (isSamePassword) {
      return res.status(400).json({
        message: "New password must be different from current password.",
      });
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `
      UPDATE users
      SET password_hash = $1,
          updated_at = NOW()
      WHERE id = $2
      `,
      [newHash, userId]
    );

    return res.json({
      message: "Password changed successfully.",
    });
  } catch (error) {
    console.error("change-password error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/privacy-status", auth, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `
      SELECT privacy_accepted, privacy_accepted_at
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    return res.json({
      data: result.rows[0],
    });
  } catch (error) {
    console.error("privacy-status error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/contact-support", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { subject, message } = req.body;

    if (!subject || !message) {
      return res.status(400).json({
        message: "Subject and message are required.",
      });
    }

    const userRes = await pool.query(
      `SELECT id, name, email, support_ref FROM users WHERE id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    const user = userRes.rows[0];
    const supportEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_USER;
    const supportRef = user.support_ref || `MNU-${String(user.id).slice(0, 8)}`;

    const html = `
      <div style="font-family: Arial, sans-serif; background:#f6f9fc; padding:24px;">
        <div style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #e5e7eb;">
          <div style="padding:18px 22px; background:linear-gradient(135deg,#2563eb,#3b82f6); color:#ffffff;">
            <h2 style="margin:0; font-size:20px;">Support Request</h2>
            <p style="margin:6px 0 0; opacity:.9;">Reference: <strong>${supportRef}</strong></p>
          </div>

          <div style="padding:22px;">
            <table style="width:100%; border-collapse:collapse; margin-bottom:18px;">
              <tr>
                <td style="padding:10px 0; color:#64748b; width:140px;"><strong>Name</strong></td>
                <td style="padding:10px 0; color:#0f172a;">${user.name}</td>
              </tr>
              <tr>
                <td style="padding:10px 0; color:#64748b;"><strong>Email</strong></td>
                <td style="padding:10px 0; color:#0f172a;">${user.email}</td>
              </tr>
              <tr>
                <td style="padding:10px 0; color:#64748b;"><strong>Support Ref</strong></td>
                <td style="padding:10px 0; color:#0f172a;">${supportRef}</td>
              </tr>
              <tr>
                <td style="padding:10px 0; color:#64748b;"><strong>Subject</strong></td>
                <td style="padding:10px 0; color:#0f172a;">${subject}</td>
              </tr>
            </table>

            <div style="border-top:1px solid #e5e7eb; padding-top:16px;">
              <div style="font-size:14px; font-weight:700; color:#334155; margin-bottom:10px;">Message</div>
              <div style="font-size:14px; color:#0f172a; line-height:1.7; background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:14px;">
                ${String(message).replace(/\n/g, "<br/>")}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    await sendMail({
      to: supportEmail,
      subject: `[${supportRef}] ${subject}`,
      html,
    });

    return res.json({
      message: "Support message sent successfully.",
      reference: supportRef,
    });
  } catch (error) {
    console.error("contact-support error:", error);
    return res.status(500).json({ message: "Failed to send support message." });
  }
});

router.delete("/delete-account", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        message: "Password is required to delete account.",
      });
    }

    const userRes = await pool.query(
      `SELECT id, password_hash FROM users WHERE id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: "User not found." });
    }

    const user = userRes.rows[0];

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(400).json({
        message: "Incorrect password.",
      });
    }

    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);

    return res.json({
      message: "Account deleted successfully.",
    });
  } catch (error) {
    console.error("delete-account error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
