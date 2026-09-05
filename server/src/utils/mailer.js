


const RESEND_API_URL = 'https://api.resend.com/emails';

// Kept as an object with a sendMail() method — same shape as the
// nodemailer transporter it replaces — so loans.js's existing
// `transporter.sendMail({ from, to, subject, text })` call site
// doesn't need to change at all.
const transporter = {
  async sendMail({ to, subject, text }) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY environment variable is not set');
    }

    const fromAddress = process.env.RESEND_FROM_EMAIL || 'Asset Lending Library <onboarding@resend.dev>';

    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [to],
        subject,
        text,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      // Resend returns 403 specifically when sending to a recipient
      // other than the account owner's own email without a verified
      // domain — surface that clearly instead of a generic failure.
      if (response.status === 403) {
        throw new Error(
          `Resend rejected this send (403) — likely because "${to}" isn't the ` +
          `Resend account's own email and no domain is verified yet. ${errorBody}`
        );
      }
      throw new Error(`Resend send failed (${response.status}): ${errorBody}`);
    }

    return response.json();
  },
};

module.exports = transporter;