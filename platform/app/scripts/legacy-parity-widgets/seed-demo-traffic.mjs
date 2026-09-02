#!/usr/bin/env node
/**
 * Seed realistic synthetic traffic through the real collector so analytics
 * charts look alive on a dev box.
 *
 * Unlike seed.mjs (widgets) and seed-sample-traces.ts (a fixed, idempotent
 * demo set), this script generates a large volume of RANDOM traces spread
 * over the past DAYS days, each with a unique id. It is NOT idempotent —
 * every run adds new traces on top of whatever is already there.
 *
 * Evaluations are intentionally skipped: seed-trace-evals.ts writes
 * directly into ClickHouse via an internal repository import
 * (EvaluationRunClickHouseRepository) and bypasses the event-sourcing
 * queue. That's a repo-internal path, not the plain-HTTP collector this
 * script is restricted to, so evaluation seeding is left out here.
 *
 * Env:
 *   LW_ENDPOINT  Base URL of the LangWatch app. Default http://localhost:5560
 *   LW_API_KEY   Project API key, sent as the X-Auth-Token header (required)
 *   DAYS         How many days back to spread traces over. Default 30
 *   PER_DAY      Target trace count per day (jittered). Default 40
 *   SEED         Optional integer to make the randomness reproducible
 *
 * Usage:
 *   LW_ENDPOINT=http://localhost:5560 LW_API_KEY=sk-lw-local-development-key \
 *     DAYS=30 PER_DAY=40 node platform/app/scripts/legacy-parity-widgets/seed-demo-traffic.mjs
 */

import crypto from "node:crypto";

const endpoint = (process.env.LW_ENDPOINT ?? "http://localhost:5560").replace(
  /\/+$/,
  "",
);
const apiKey = process.env.LW_API_KEY;
if (!apiKey) {
  console.error("Missing required env var LW_API_KEY");
  process.exit(1);
}
const DAYS = Number(process.env.DAYS ?? 30);
const PER_DAY = Number(process.env.PER_DAY ?? 40);

// Locality guard: this script POSTs an ingestion key to LW_ENDPOINT. Refuse
// anything but a local host so a stray env var can't leak the key or spam a
// real project. Mirrors seed-sample-traces.ts.
function assertLocalEndpoint(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    console.error(`Refusing to seed: LW_ENDPOINT is not a valid URL (${url}).`);
    process.exit(1);
  }
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLocal =
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost");
  if (!isLocal) {
    console.error(
      `Refusing to seed: LW_ENDPOINT host "${hostname}" is not local. ` +
        "This script only targets localhost, 127.0.0.1, ::1, or *.localhost.",
    );
    process.exit(1);
  }
}
assertLocalEndpoint(endpoint);

// --- seeded PRNG (mulberry32) for reproducible runs when SEED is set ------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = process.env.SEED
  ? mulberry32(Number(process.env.SEED))
  : Math.random;

function randInt(min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}
function weightedPick(entries) {
  // entries: [{ value, weight }]
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let r = rand() * total;
  for (const e of entries) {
    r -= e.weight;
    if (r <= 0) return e.value;
  }
  return entries[entries.length - 1].value;
}
// log-normal-ish sample: exp(mean + stdev * gaussian)
function lognormal(mean, stdev) {
  // Box-Muller
  const u1 = Math.max(rand(), 1e-9);
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.exp(mean + stdev * z);
}

// --- model catalog: weight + per-1k-token rates ($) -----------------------
const MODELS = [
  { value: "gpt-5-mini", weight: 35, inRate: 0.00025, outRate: 0.002 },
  { value: "gpt-5", weight: 15, inRate: 0.00125, outRate: 0.01 },
  { value: "claude-sonnet-5", weight: 25, inRate: 0.003, outRate: 0.015 },
  { value: "claude-haiku-4", weight: 20, inRate: 0.0008, outRate: 0.004 },
  { value: "gemini-3-flash", weight: 5, inRate: 0.000075, outRate: 0.0003 },
];

const USER_QUESTIONS = [
  "I was charged twice for my subscription this month, can you help?",
  "How do I reset my API key?",
  "What's the rate limit on the traces endpoint?",
  "My webhook stopped firing after the last deploy, any ideas?",
  "Can you summarize this ticket for me?",
  "How do I invite teammates to my workspace?",
  "Why is my dashboard showing stale data?",
  "Is there a way to export my traces to CSV?",
  "What plan am I currently on?",
  "The chatbot gave a wrong answer to a customer, can you check the trace?",
  "How do I set up SSO for my org?",
  "Can you translate this error message for me?",
];
const ASSISTANT_ANSWERS = [
  "I checked your billing history and see the duplicate charge — I've flagged it for a refund, which should land in 3-5 business days.",
  "You can rotate your API key from Settings -> API Keys. The old key stays valid for 24h so nothing breaks mid-rotation.",
  "The traces endpoint accepts up to 3,000 requests per minute per project, batched per trace.",
  "That looks like a signature mismatch after the deploy. Double check the webhook secret matches the one in Settings -> Webhooks.",
  "Here's a short summary: the customer was double-billed, root cause was a retried payment, refund issued automatically.",
  "Go to Settings -> Members and click Invite — paste multiple emails at once.",
  "Dashboards refresh every 60s; a stale view usually clears on a hard refresh, but I've also kicked the projection worker for your project.",
  "Yes, use the Export button on the Traces table, or the /api/traces endpoint with format=csv.",
  "You're currently on the Pro plan, billed monthly.",
  "I pulled up the trace — the model hallucinated a policy detail that isn't in the retrieved context.",
  "SSO is configured under Settings -> Security -> SSO, using your IdP's SAML metadata URL.",
  "That error means the request timed out upstream; it's transient and safe to retry.",
];
const RAG_SNIPPETS = [
  "Retrieved doc: refund policy applies within 30 days of purchase.",
  "Retrieved doc: rate limits reset every 60 seconds on a rolling window.",
  "Retrieved doc: SSO requires a verified admin email on the workspace.",
];

const LABEL_SETS = [
  ["support", "billing"],
  ["product", "onboarding"],
  ["docs-assistant", "rag"],
  ["summarization"],
  ["bug-report"],
  ["translation"],
];

const USERS = Array.from({ length: 18 }, (_, i) => `demo-user-${i + 1}`);
const CUSTOMERS = Array.from({ length: 10 }, (_, i) => `demo-customer-${i + 1}`);

// pre-build a pool of threads (some multi-trace) to feed avg-traces/thread
const THREAD_POOL = Array.from({ length: 120 }, (_, i) => ({
  threadId: `demo-thread-${i + 1}`,
  userId: pick(USERS),
  customerId: pick(CUSTOMERS),
  size: weightedPick([
    { value: 1, weight: 60 },
    { value: 2, weight: 20 },
    { value: 3, weight: 10 },
    { value: 4, weight: 6 },
    { value: 5, weight: 4 },
  ]),
  used: 0,
}));

function nextThread() {
  // reuse a thread with remaining capacity ~40% of the time, else start fresh
  const candidates = THREAD_POOL.filter((t) => t.used < t.size);
  if (candidates.length && rand() < 0.4) {
    const t = pick(candidates);
    t.used++;
    return t;
  }
  const t = pick(THREAD_POOL);
  t.used++;
  return t;
}

function buildLlmSpan(spanId, isError) {
  const model = weightedPick(MODELS);
  const promptTokens = Math.round(lognormal(5.2, 0.6)); // ~ 100-400 typical
  const completionTokens = Math.round(lognormal(4.8, 0.7)); // ~ 60-350 typical
  const cost =
    (promptTokens / 1000) * model.inRate +
    (completionTokens / 1000) * model.outRate;
  const question = pick(USER_QUESTIONS);
  const answer = pick(ASSISTANT_ANSWERS);
  return {
    type: "llm",
    span_id: spanId,
    name: "chat-completion",
    model: model.value,
    input: {
      type: "chat_messages",
      value: [
        { role: "system", content: "You are a helpful support assistant." },
        { role: "user", content: question },
      ],
    },
    output: isError
      ? { type: "text", value: "" }
      : {
          type: "chat_messages",
          value: [{ role: "assistant", content: answer }],
        },
    metrics: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost: Number(cost.toFixed(6)),
    },
    ...(isError
      ? { error: { message: "upstream model request failed", stack: null } }
      : {}),
  };
}

function buildRagSpan(spanId) {
  return {
    type: "rag",
    span_id: spanId,
    name: "retrieve-context",
    input: { type: "text", value: pick(USER_QUESTIONS) },
    output: {
      type: "list",
      value: [pick(RAG_SNIPPETS), pick(RAG_SNIPPETS)],
    },
  };
}

function buildToolSpan(spanId) {
  return {
    type: "tool",
    span_id: spanId,
    name: "lookup-account",
    input: { type: "json", value: { query: "account_lookup" } },
    output: { type: "json", value: { found: true } },
  };
}

// business-hours + weekday weighting: returns a fraction 0..1 of "activity"
function activityWeight(date) {
  const day = date.getUTCDay(); // 0 Sun .. 6 Sat
  const hour = date.getUTCHours();
  const weekdayFactor = day === 0 || day === 6 ? 0.35 : 1.0;
  // business hours 8-18 UTC get most weight, taper off outside
  let hourFactor;
  if (hour >= 8 && hour <= 18) hourFactor = 1.0;
  else if (hour >= 6 && hour < 8) hourFactor = 0.5;
  else if (hour > 18 && hour <= 21) hourFactor = 0.5;
  else hourFactor = 0.15;
  return weekdayFactor * hourFactor;
}

function randomTimestampOnDay(dayStartMs) {
  // pick an hour weighted by business-hours activity via rejection sampling
  for (let attempt = 0; attempt < 20; attempt++) {
    const hour = randInt(0, 23);
    const minute = randInt(0, 59);
    const second = randInt(0, 59);
    const t = new Date(dayStartMs);
    t.setUTCHours(hour, minute, second, 0);
    if (rand() < activityWeight(t)) return t.getTime();
  }
  const t = new Date(dayStartMs);
  t.setUTCHours(12, 0, 0, 0);
  return t.getTime();
}

function buildTrace(finishedAtMs) {
  const traceId = `demo-traffic-${crypto.randomUUID()}`;
  const thread = nextThread();
  const isError = rand() < 0.05;
  const numSpans = randInt(1, 4);

  const durationMs = Math.min(
    20000,
    Math.max(300, Math.round(lognormal(6.6, 0.9))), // long tail up to ~20s
  );
  const startedAtMs = finishedAtMs - durationMs;

  const spans = [];
  // deterministic composition: always >=1 llm span, optionally rag/tool
  spans.push(buildLlmSpan(`${traceId}-llm-1`, isError));
  if (numSpans >= 2) spans.push(buildRagSpan(`${traceId}-rag-1`));
  if (numSpans >= 3) spans.push(buildToolSpan(`${traceId}-tool-1`));
  if (numSpans >= 4) spans.push(buildLlmSpan(`${traceId}-llm-2`, false));

  // spread span timestamps evenly across the trace duration
  const step = Math.max(1, Math.floor(durationMs / spans.length));
  spans.forEach((span, i) => {
    const spanStart = startedAtMs + i * step;
    const spanEnd = i === spans.length - 1 ? finishedAtMs : spanStart + step;
    span.timestamps = { started_at: spanStart, finished_at: spanEnd };
  });

  return {
    trace_id: traceId,
    spans,
    metadata: {
      user_id: thread.userId,
      thread_id: thread.threadId,
      customer_id: thread.customerId,
      labels: [...pick(LABEL_SETS), "demo-traffic-seed"],
    },
  };
}

async function post(trace) {
  const response = await fetch(`${endpoint}/api/collector`, {
    method: "POST",
    headers: {
      "X-Auth-Token": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(trace),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${response.status}: ${await response.text()}`);
  }
}

// small concurrency pool
async function runPool(items, worker, concurrency) {
  let index = 0;
  let succeeded = 0;
  let failed = 0;
  async function next() {
    while (index < items.length) {
      const i = index++;
      try {
        await worker(items[i]);
        succeeded++;
      } catch (err) {
        failed++;
        console.error(`  failed: ${err.message ?? err}`);
      }
      if (succeeded + failed > 0 && (succeeded + failed) % 100 === 0) {
        console.log(`  progress: ${succeeded + failed}/${items.length}`);
      }
    }
  }
  const workers = Array.from({ length: concurrency }, () => next());
  await Promise.all(workers);
  return { succeeded, failed };
}

async function main() {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const traces = [];

  for (let d = DAYS - 1; d >= 0; d--) {
    const dayStart = new Date(now - d * dayMs);
    dayStart.setUTCHours(0, 0, 0, 0);
    const activity = activityWeight(
      new Date(dayStart.getTime() + 12 * 60 * 60 * 1000),
    );
    // mild upward trend: more recent days get slightly more traffic
    const trend = 0.8 + 0.4 * ((DAYS - 1 - d) / Math.max(1, DAYS - 1));
    const jitter = 0.75 + rand() * 0.5; // +/-25%
    const dayWeekdayFactor =
      dayStart.getUTCDay() === 0 || dayStart.getUTCDay() === 6 ? 0.5 : 1.0;
    const count = Math.max(
      1,
      Math.round(PER_DAY * trend * jitter * dayWeekdayFactor),
    );
    for (let i = 0; i < count; i++) {
      const ts = randomTimestampOnDay(dayStart.getTime());
      traces.push(buildTrace(Math.min(ts, now)));
    }
    void activity;
  }

  console.log(
    `Seeding ${traces.length} synthetic traces over the last ${DAYS} days into ${endpoint} ...`,
  );

  const { succeeded, failed } = await runPool(
    traces,
    (trace) => post(trace),
    5,
  );

  const failRate = failed / traces.length;
  console.log(
    `Done. ${succeeded} succeeded, ${failed} failed, out of ${traces.length} total ` +
      `(days=${DAYS}, per_day~${PER_DAY}).`,
  );
  if (failRate > 0.02) {
    console.error(
      `Failure rate ${(failRate * 100).toFixed(1)}% exceeds 2% threshold.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
