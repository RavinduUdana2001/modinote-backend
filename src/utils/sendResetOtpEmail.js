const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function sendResetOtpEmail(toEmail, otp) {
  const mins = process.env.OTP_EXPIRES_MIN || 10;

  return transporter.sendMail({
    from: `"MediNote" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: "MediNote Password Reset Code",
    text: `Your password reset code is ${otp}. It expires in ${mins} minutes.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5">
        <h2>Password Reset</h2>
        <p>Your OTP code:</p>
        <div style="font-size:28px;font-weight:800;letter-spacing:6px;margin:16px 0">${otp}</div>
        <p>Expires in <b>${mins} minutes</b>.</p>
        <p>If you didn’t request this, ignore this email.</p>
      </div>
    `,
  });
}

module.exports = { sendResetOtpEmail };