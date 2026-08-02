/**
 * Focused check: does the SMTP gateway leak blind recipients into the message
 * headers? Sends one message with a bcc and prints the raw header block that
 * each recipient would actually receive.
 */
import { sendEmail } from "../src/server/mailer/emailSender";

const MAILPIT = "http://127.0.0.1:8025";

async function main() {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });

  await sendEmail({
    to: ["primary@example.com", "second@example.com"],
    bcc: ["hidden@example.com"],
    subject: "BCC leakage check",
    html: "<p>body</p>",
  });

  const list = (await (await fetch(`${MAILPIT}/api/v1/messages`)).json())
    .messages as Array<{ ID: string }>;

  for (const m of list) {
    const raw = await (
      await fetch(`${MAILPIT}/api/v1/message/${m.ID}/raw`)
    ).text();
    const headerBlock = raw.split(/\r?\n\r?\n/)[0] ?? "";
    console.log(`=== message ${m.ID} ===`);
    for (const line of headerBlock.split(/\r?\n/)) {
      if (/^(to|bcc|cc|from|subject):/i.test(line)) console.log(`   ${line}`);
    }
    console.log(
      `   contains "hidden@example.com" anywhere in headers: ${/hidden@example\.com/i.test(headerBlock)}`,
    );
  }

  const detail = await (
    await fetch(`${MAILPIT}/api/v1/message/${list[0]!.ID}`)
  ).json();
  console.log("\nmailpit parsed envelope:");
  console.log("   To:  ", JSON.stringify(detail.To));
  console.log("   Bcc: ", JSON.stringify(detail.Bcc));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
