import fetch from "node-fetch";

export async function sendEmail({ to, subject, html, text }) {
  const { RESEND_API_KEY, SMTP_FROM } = process.env;
  if (!RESEND_API_KEY) {
    console.error("[email] Missing RESEND_API_KEY");
    return;
  }

  const from = SMTP_FROM || "VoucherHub <info@voucherhub.pt>";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("[email] Failed:", data);
    throw new Error(data.message || "Erro ao enviar email via Resend");
  }

  console.log("[email] sent", data);
  return data;
}
