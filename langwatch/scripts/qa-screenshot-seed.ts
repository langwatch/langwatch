/**
 * Seeds a realistic inbox in Mailpit for the PR screenshots: the kinds of mail
 * LangWatch actually sends, delivered through the SMTP gateway.
 */
import { sendEmail } from "../src/server/mailer/emailSender";
import { sendRenderedTriggerEmail } from "../src/server/mailer/triggerEmail";

const MAILPIT = "http://127.0.0.1:8025";

async function main() {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });

  await sendRenderedTriggerEmail({
    triggerEmails: ["ops@acme.com"],
    triggerId: "trigger-transbordo",
    projectId: "project-acme",
    subject: "Alert: transbordo para humano above threshold",
    html: `
      <h2 style="font-family:sans-serif">Quantidade de transbordos teste alerta</h2>
      <p style="font-family:sans-serif">Current value: <strong>476</strong> (threshold: greater than 3)</p>
      <p style="font-family:sans-serif">Evaluated over the last 15 minutes.</p>
    `,
  });

  await sendEmail({
    to: ["analyst@acme.com"],
    replyTo: "support@langwatch.ai",
    subject: "Your weekly LangWatch report",
    html: `
      <h2 style="font-family:sans-serif">Weekly report</h2>
      <p style="font-family:sans-serif">476 traces, 6 escalations to a human.</p>
    `,
    headers: { "X-LangWatch-Report": "weekly" },
    attachments: [
      {
        filename: "weekly-report.csv",
        content: "metric,value\ntraces,476\nescalations,6",
        contentType: "text/csv",
      },
    ],
  });

  await sendEmail({
    to: "newteammate@acme.com",
    subject: "You have been invited to join Acme on LangWatch",
    html: `
      <h2 style="font-family:sans-serif">You're invited</h2>
      <p style="font-family:sans-serif">Join the Acme organization on LangWatch.</p>
    `,
  });

  const total = (await (await fetch(`${MAILPIT}/api/v1/messages`)).json()).total;
  console.log(`seeded ${total} messages through the SMTP gateway`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
