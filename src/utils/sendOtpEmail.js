const { sendMail } = require("./mailer");

async function sendOtpEmail(toEmail, otp) {
  const mins = process.env.OTP_EXPIRES_MIN || 10;

  return sendMail({
    to: toEmail,
    subject: "MediNote Verification Code",
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5">
        <h2>MediNote Email Verification</h2>
        <p>Your 6-digit code:</p>
        <div style="font-size:28px;font-weight:800;letter-spacing:6px;margin:16px 0">${otp}</div>
        <p>This code expires in <b>${mins} minutes</b>.</p>
      </div>
    `,
  });
}

module.exports = { sendOtpEmail };
