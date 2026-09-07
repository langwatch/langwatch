// Better Stack Playwright monitor: does Langy still answer a greeting?
//
// This file is pasted into the monitor verbatim by
// scripts/uptime/upsert-langy-greeting-monitor.ts. It is self-contained on
// purpose (the monitor runtime cannot import from this repo) and mirrors
// scripts/uptime/langy-greeting-check.ts, which is the unit-tested source of
// truth; a drift test pins the greeting, the wait and the reason names.
//
// Monitor environment variables (set by the provisioning script):
//   LANGY_BASE_URL  - deployment origin, e.g. https://app.example.com
//   LANGY_API_KEY   - a Langy user's project API key with langy:create
//
// Every run mints a NEW idempotency key. The platform replays a repeated key
// for the same project and user without running the assistant, so a fixed key
// would keep this monitor green through an outage.

import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const GREETING = "Hi Langy.";
const WAIT_SECONDS = 90;
const PATH = "/api/langy/conversations";

function required(name) {
  const value = process.env[name];
  if (!value)
    throw new Error(`monitor environment variable ${name} is not set`);
  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Same table as classifyGreetingResponse in langy-greeting-check.ts.
// `null` means healthy.
function settledReason(body) {
  if (!isRecord(body) || !body.conversationId || !body.turnId)
    return "malformed_body";
  const reply = isRecord(body.reply) ? body.reply : null;
  if (reply === null || typeof reply.text !== "string") return "turn_failed";
  if (reply.text.trim().length === 0) return "empty_reply";
  return null;
}

const REFUSAL_BY_STATUS = {
  202: "not_settled",
  404: "surface_dark",
  401: "unauthorized",
  403: "forbidden",
};

function reasonFor(status, body) {
  if (status === 200) return settledReason(body);
  return REFUSAL_BY_STATUS[status] ?? "unexpected_status";
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The turn's own error, with the key scrubbed: an upstream message may echo
// the header it rejected, and this string lands in the incident timeline.
function detailOf(envelope, apiKey) {
  const raw =
    (isRecord(envelope.error) ? envelope.error.message : envelope.error) ??
    envelope.status ??
    null;
  return typeof raw === "string" && apiKey.length > 0
    ? raw.split(apiKey).join("<redacted>")
    : raw;
}

async function postGreeting(baseUrl, apiKey, idempotencyKey) {
  return fetch(`${baseUrl}${PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Token": apiKey,
      Prefer: `wait=${WAIT_SECONDS}`,
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: GREETING }],
      idempotencyKey,
    }),
  });
}

// Playwright's default per-test timeout is 30s, shorter than the wait. The
// test must outlive the server-side wait plus transport, or a slow cold start
// fails as a test timeout instead of a named reason.
test.setTimeout((WAIT_SECONDS + 20) * 1000);

test("Langy answers a greeting", async () => {
  const baseUrl = required("LANGY_BASE_URL").replace(/\/+$/, "");
  const apiKey = required("LANGY_API_KEY");
  const idempotencyKey = randomUUID();

  const started = Date.now();
  let response;
  try {
    response = await postGreeting(baseUrl, apiKey, idempotencyKey);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(
      JSON.stringify({
        healthy: false,
        reason: "unreachable",
        idempotencyKey,
        detail,
      }),
    );
    throw new Error(`unreachable: ${detail}`);
  }
  const durationMs = Date.now() - started;

  const body = parseJson(await response.text());
  const reason = reasonFor(response.status, body);
  const envelope = isRecord(body) ? body : {};
  const detail = reason === null ? null : detailOf(envelope, apiKey);

  // This line lands in the incident timeline: ids and timing, never the key.
  console.log(
    JSON.stringify({
      healthy: reason === null,
      reason,
      status: response.status,
      durationMs,
      idempotencyKey,
      conversationId: envelope.conversationId ?? null,
      turnId: envelope.turnId ?? null,
      detail,
    }),
  );

  expect(
    reason,
    `langy greeting check failed: ${reason} (status ${response.status}${detail ? `, ${detail}` : ""})`,
  ).toBeNull();
});
