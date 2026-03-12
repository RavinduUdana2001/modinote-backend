const { sendMail } = require("./mailer");

async function sendResetOtpEmail(toEmail, otp) {
  const mins = process.env.OTP_EXPIRES_MIN || 10;

  return sendMail({
    to: toEmail,
    subject: "MediNote Password Reset Code",
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5">
        <h2>Password Reset</h2>
        <p>Your OTP code:</p>
        <div style="font-size:28px;font-weight:800;letter-spacing:6px;margin:16px 0">${otp}</div>
        <p>Expires in <b>${mins} minutes</b>.</p>
        <p>If you did not request this, ignore this email.</p>
      </div>
    `,
  });
}

module.exports = { sendResetOtpEmail };
