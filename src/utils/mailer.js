const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
});

async function sendTestEmail(to) {
  return transporter.sendMail({
    from: `"MediNote" <${process.env.SMTP_USER}>`,
    to,
    subject: "MediNote Email Test",
    text: "This is a test email from your MediNote backend.",
    html: `
      <div style="font-family:Arial,sans-serif">
        <h2>MediNote Email Test</h2>
        <p>If you received this, your SMTP settings work correctly.</p>
      </div>
    `,
  });
}

async function sendMail({ to, subject, html }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error("SMTP is not configured. Please set SMTP_HOST, SMTP_USER, SMTP_PASS.");
  }

  return transporter.sendMail({
    from: process.env.SMTP_FROM || `"MediNote Support" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
  });
}

module.exports = {
  sendTestEmail,
  sendMail,
};
