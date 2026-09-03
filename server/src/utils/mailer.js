require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASS,
  },
});

// Optional but useful — verify connection once when server starts,
// so you know immediately if credentials are wrong instead of finding
// out only when the first reminder fails.
transporter.verify((error, success) => {
  if (error) {
    console.error('Mailer setup failed:', error.message);
  } else {
    console.log('Mailer is ready to send emails');
  }
});

module.exports = transporter;