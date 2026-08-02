/**
 * Live QA for the email gateways: sends real LangWatch emails through the real
 * mailer into a local Mailpit SMTP server, then asserts what actually arrived
 * over the wire (headers, attachments, envelope recipients).
 *
 *   mailpit --smtp 127.0.0.1:1025 --listen 127.0.0.1:8025
 *   EMAIL_PROVIDER=smtp SMTP_URL=smtp://127.0.0.1:1025 \
 *     pnpm tsx scripts/qa-email-gateways.ts
 */
import { sendEmail } from "../src/server/mailer/emailSender";
import { sendRenderedTriggerEmail } from "../src/server/mailer/triggerEmail";

const MAILPIT = "http://127.0.0.1:8025";

const api = async (path: string) => {
  const res = await fetch(`${MAILPIT}${path}`);
  if (!res.ok) throw new Error(`mailpit ${path} -> ${res.status}`);
  return res.json();
};

const reset = async () => {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
};

const messages = async () => (await api("/api/v1/messages")).messages ?? [];

const messageDetail = async (id: string) => api(`/api/v1/message/${id}`);
const rawSource = async (id: string) => {
  const res = await fetch(`${MAILPIT}/api/v1/message/${id}/raw`);
  return res.text();
};

let failures = 0;
const check = (label: string, condition: boolean, detail?: string) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

async function scenarioPlainAlert() {
  console.log("\n[1] a real rendered trigger alert email");
  await reset();

  await sendRenderedTriggerEmail({
    triggerEmails: ["gabriel@example.com"],
    triggerId: "trigger-qa-1",
    projectId: "project-qa",
    subject: "Alerta: transbordo para humano acima do limite",
    html: "<h1>Quantidade de transbordos teste alerta</h1><p>Current value: 476 (threshold: gt 3)</p>",
  });

  const list = await messages();
  check("exactly one message arrived", list.length === 1, `got ${list.length}`);
  const detail = await messageDetail(list[0].ID);
  check(
    "subject preserved",
    detail.Subject === "Alerta: transbordo para humano acima do limite",
    detail.Subject,
  );
  // Trigger emails deliberately address a per-trigger no-reply and deliver the
  // real recipient blind, so addresses can't be enumerated (triggerNoReply.ts).
  check(
    "addressed to the per-trigger no-reply",
    /^no-reply\+/.test(detail.To?.[0]?.Address ?? ""),
    JSON.stringify(detail.To),
  );
  check(
    "real recipient received it blind",
    JSON.stringify(detail.Bcc ?? []).includes("gabriel@example.com"),
    JSON.stringify(detail.Bcc),
  );
  check(
    "alert body rendered",
    (detail.HTML ?? "").includes("476"),
    "value missing from body",
  );

  const raw = await rawSource(list[0].ID);
  check(
    "List-Unsubscribe header delivered through SMTP",
    /List-Unsubscribe:/i.test(raw),
  );
  return list[0].ID;
}

async function scenarioFullSurface() {
  console.log("\n[2] attachments, blind copies, reply-to and custom headers");
  await reset();

  await sendEmail({
    to: ["primary@example.com", "second@example.com"],
    bcc: ["hidden@example.com"],
    replyTo: "support@langwatch.ai",
    subject: "Relatório semanal",
    html: "<p>Segue o relatório.</p>",
    headers: { "X-LangWatch-QA": "gateway-smoke" },
    attachments: [
      {
        filename: "report.csv",
        content: "metric,value\ntransbordos,476",
        contentType: "text/csv",
      },
    ],
  });

  const list = await messages();
  // Mailpit stores one message per envelope recipient delivery.
  check("message delivered", list.length >= 1, `got ${list.length}`);

  const detail = await messageDetail(list[0].ID);
  const raw = await rawSource(list[0].ID);

  check(
    "attachment present",
    (detail.Attachments ?? []).some(
      (a: { FileName: string }) => a.FileName === "report.csv",
    ),
    JSON.stringify(detail.Attachments),
  );
  check("reply-to set", /Reply-To:\s*support@langwatch\.ai/i.test(raw));
  check("custom header delivered", /X-LangWatch-QA:\s*gateway-smoke/i.test(raw));
  check(
    "both visible recipients in To header",
    /primary@example\.com/.test(raw) && /second@example\.com/.test(raw),
  );
  // Mailpit reconstructs a Bcc line from the SMTP envelope for developer
  // visibility, so it cannot show whether we emitted one. scripts/qa-mime-isolate.ts
  // asserts the wire format directly.

  const envelopeRecipients = new Set<string>();
  for (const m of list) {
    const d = await messageDetail(m.ID);
    for (const r of d.To ?? []) envelopeRecipients.add(r.Address);
    for (const r of d.Bcc ?? []) envelopeRecipients.add(r.Address);
  }
  check(
    "blind recipient still received the message",
    JSON.stringify(list).includes("hidden@example.com") ||
      envelopeRecipients.has("hidden@example.com"),
    `envelope: ${[...envelopeRecipients].join(", ")}`,
  );
}

async function scenarioUnicode() {
  console.log("\n[3] non-ASCII subject survives the transport");
  await reset();

  await sendEmail({
    to: "acentos@example.com",
    subject: "Transbordo para humano: atenção à média não prevista",
    html: "<p>Configuração validada.</p>",
  });

  const list = await messages();
  const detail = await messageDetail(list[0].ID);
  check(
    "subject decoded correctly",
    detail.Subject === "Transbordo para humano: atenção à média não prevista",
    detail.Subject,
  );
}

async function main() {
  console.log(`provider: ${process.env.EMAIL_PROVIDER}`);
  console.log(`smtp:     ${process.env.SMTP_URL}`);

  await scenarioPlainAlert();
  await scenarioFullSurface();
  await scenarioUnicode();

  console.log(
    failures === 0
      ? "\nAll gateway checks passed."
      : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
