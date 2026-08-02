/**
 * Isolates what our SMTP options actually serialize to, independent of what
 * Mailpit chooses to display. Builds the message with nodemailer's in-memory
 * transport and prints the exact MIME we would put on the wire.
 */
import nodemailer from "nodemailer";

async function render(label: string, message: Record<string, unknown>) {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
  });
  const info = await transport.sendMail(message as never);
  const raw = info.message.toString();
  const headerBlock = raw.split(/\r?\n\r?\n/)[0] ?? "";

  console.log(`\n=== ${label} ===`);
  for (const line of headerBlock.split(/\r?\n/)) {
    if (/^(to|bcc|cc|from|subject):/i.test(line)) console.log(`   ${line}`);
  }
  console.log(`   envelope actually used: ${JSON.stringify(info.envelope)}`);
  console.log(
    `   Bcc header present in MIME: ${/^Bcc:/im.test(headerBlock)}`,
  );
}

async function main() {
  // What the old code did.
  await render("passing bcc as a message field (previous behaviour)", {
    from: "LangWatch <noreply@langwatch.ai>",
    to: ["primary@example.com", "second@example.com"],
    bcc: ["hidden@example.com"],
    subject: "BCC check",
    html: "<p>body</p>",
  });

  // What the code does now.
  await render("envelope-only blind recipients (current behaviour)", {
    from: "LangWatch <noreply@langwatch.ai>",
    to: ["primary@example.com", "second@example.com"],
    envelope: {
      from: "LangWatch <noreply@langwatch.ai>",
      to: ["primary@example.com", "second@example.com", "hidden@example.com"],
    },
    subject: "BCC check",
    html: "<p>body</p>",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
