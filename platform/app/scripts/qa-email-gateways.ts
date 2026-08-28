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
import { AppAwsClientConfiguration } from "../src/runtime/app/aws-client.composition";
import { AppMailerRuntime } from "../src/runtime/app/mailer.runtime";
import { resolveAppMailerConfiguration } from "../src/runtime/app/mailer.private-config";
import { parseOutboundProxyConfig } from "../src/server/outboundProxy";
import { sendRenderedTriggerEmail } from "../src/server/mailer/triggerEmail";

const MAILPIT = "http://127.0.0.1:8025";

const outboundProxy = parseOutboundProxyConfig(process.env);
const aws = AppAwsClientConfiguration.create(outboundProxy);
const mailer = AppMailerRuntime.create({
  configuration: resolveAppMailerConfiguration({
    ...process.env,
    BASE_HOST: process.env.BASE_HOST ?? "http://localhost",
  }),
  aws,
  outboundProxy,
});

const closeMailerGraph = async (): Promise<void> => {
  let firstFailure: unknown;
  for (const close of [() => mailer.close(), () => aws.close()]) {
    try {
      await close();
    } catch (error) {
      firstFailure ??= error;
    }
  }
  if (firstFailure) throw firstFailure;
};

/**
 * Only the scheme and host of an SMTP URL. Credentials are dropped entirely
 * rather than pattern-replaced, so a password containing a raw `@` cannot leak
 * a fragment of itself.
 */
const redactUserinfo = (url: string | undefined): string => {
  if (!url) return "(unset)";
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "(unparseable SMTP_URL)";
  }
};

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
    console.log(`  FAIL  ${label}${detail ? `: ${detail}` : ""}`);
  }
};

/** Every address Mailpit saw delivered, across the To and Bcc of each copy. */
async function collectEnvelopeRecipients(list: { ID: string }[]): Promise<Set<string>> {
  const addresses = new Set<string>();
  for (const m of list) {
    const d = await messageDetail(m.ID);
    for (const r of d.To ?? []) addresses.add(r.Address);
    for (const r of d.Bcc ?? []) addresses.add(r.Address);
  }
  return addresses;
}

async function scenarioPlainAlert() {
  console.log("\n[1] a real rendered trigger alert email");
  await reset();

  await sendRenderedTriggerEmail({
    mailer,
    triggerEmails: ["gabriel@example.com"],
    triggerId: "trigger-qa-1",
    projectId: "project-qa",
    subject: "Alerta: transbordo para humano acima do limite",
    html: "<h1>Quantidade de transbordos teste alerta</h1><p>Current value: 476 (threshold: gt 3)</p>",
  });

  const list = await messages();
  check("exactly one message arrived", list.length === 1, `got ${list.length}`);
  const first = list[0];
  if (!first) return;
  const detail = await messageDetail(first.ID);
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
  check("alert body rendered", (detail.HTML ?? "").includes("476"), "value missing from body");

  const raw = await rawSource(first.ID);
  check("List-Unsubscribe header delivered through SMTP", /List-Unsubscribe:/i.test(raw));
}

async function scenarioFullSurface() {
  console.log("\n[2] attachments, blind copies, reply-to and custom headers");
  await reset();

  await sendEmail({
    mailer,
    content: {
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
    },
  });

  const list = await messages();
  // Mailpit stores one message per envelope recipient delivery.
  check("message delivered", list.length >= 1, `got ${list.length}`);
  const first = list[0];
  if (!first) return;

  const detail = await messageDetail(first.ID);
  const raw = await rawSource(first.ID);

  check(
    "attachment present",
    (detail.Attachments ?? []).some((a: { FileName: string }) => a.FileName === "report.csv"),
    JSON.stringify(detail.Attachments),
  );
  check("reply-to set", /Reply-To:\s*support@langwatch\.ai/i.test(raw));
  check("custom header delivered", /X-LangWatch-QA:\s*gateway-smoke/i.test(raw));
  check(
    "both visible recipients in To header",
    /primary@example\.com/.test(raw) && /second@example\.com/.test(raw),
  );
  // Mailpit reconstructs a Bcc line from the SMTP envelope for developer
  // visibility, so it cannot show whether one was emitted. Confirming the wire
  // format needs a real SMTP round trip against a sink that records DATA;
  // streamTransport would false-positive here.
  const envelopeRecipients = await collectEnvelopeRecipients(list);
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
    mailer,
    content: {
      to: "acentos@example.com",
      subject: "Transbordo para humano: atenção à média não prevista",
      html: "<p>Configuração validada.</p>",
    },
  });

  const list = await messages();
  check("exactly one message arrived", list.length === 1, `got ${list.length}`);
  const first = list[0];
  if (!first) return;
  const detail = await messageDetail(first.ID);
  check(
    "subject decoded correctly",
    detail.Subject === "Transbordo para humano: atenção à média não prevista",
    detail.Subject,
  );
}

async function main() {
  console.log(`provider: ${process.env.EMAIL_PROVIDER}`);
  // SMTP_URL can carry inline credentials; print only scheme and host.
  console.log(`smtp:     ${redactUserinfo(process.env.SMTP_URL)}`);

  await scenarioPlainAlert();
  await scenarioFullSurface();
  await scenarioUnicode();

  console.log(failures === 0 ? "\nAll gateway checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeMailerGraph());
