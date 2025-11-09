import nodemailer from 'nodemailer';

/**
 * Sends an email using SMTP via Nodemailer.
 * Provide SMTP_* env vars or your platform's SMTP relay.
 */
export async function sendEmail({ to, subject, html, text }) {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM
  } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    console.warn('[email] SMTP env vars not fully configured; skipping send.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT || 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  const info = await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    text: text || '',
    html
  });

  console.log('[email] sent', info.messageId);
  return info;
}
