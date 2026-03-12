const bcrypt = require("bcrypt");
const pool = require("../db");
const { sendOtpEmail } = require("./sendOtpEmail");

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

async function createAndSendOtp(userId, email) {
  const otp = generateOtp();
  const code_hash = await bcrypt.hash(otp, 10);

  const mins = Number(process.env.OTP_EXPIRES_MIN || 10);
  const expiresAt = new Date(Date.now() + mins * 60 * 1000);

  await pool.query(
    `INSERT INTO email_otps (user_id, code_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, code_hash, expiresAt]
  );

  await sendOtpEmail(email, otp);

  return true;
}

module.exports = { createAndSendOtp };