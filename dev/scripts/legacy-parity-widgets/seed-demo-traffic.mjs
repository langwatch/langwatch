#!/usr/bin/env node
// @ts-nocheck

/**
 * Seeds realistic synthetic RANDOM traffic through the real collector so
 * analytics charts and dashboards show every state. NOT idempotent: every
 * run adds new traces and scenario runs. Evaluations are skipped.
 */

import crypto from "node:crypto";

const endpoint = (process.env.LW_ENDPOINT ?? "http://localhost:5560").replace(/\/+$/, "");
const apiKey = process.env.LW_API_KEY;
if (!apiKey) {
  console.error("Missing required env var LW_API_KEY");
  process.exit(1);
}
// Both drive unbounded `for` loops below, so a non-finite, non-integer,
// negative or absurdly large value would spin forever or exhaust memory.
// Validate and cap before generating anything.
function positiveIntEnv(name, fallback, max) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    console.error(`Invalid ${name}=${raw}: expected an integer between 1 and ${max}.`);
    process.exit(1);
  }
  return value;
}

const DAYS = positiveIntEnv("DAYS", 30, 3650);
const PER_DAY = positiveIntEnv("PER_DAY", 40, 100000);

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
  : () => crypto.randomInt(0, 2 ** 47) / 2 ** 47; // randomInt needs max - min below 2 ** 48

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

// --- models: LangWatch prices the first four from its own price list; the
// fine-tune has no price, so its traces carry an unpriced span.
const MODELS = [
  { value: "gpt-5-mini", weight: 35 },
  { value: "gpt-5", weight: 15 },
  { value: "claude-sonnet-4.5", weight: 30 },
  { value: "gemini-2.5-pro", weight: 12 },
  { value: "acme-finetune-v2", weight: 8 },
];

// A day with no traffic, so charts show a gap rather than a zero.
const QUIET_DAYS_AGO = 2;
// Shares of traces that carry each optional field: some fields arrive on part of the traffic.
const FIELD_SHARE = { user: 0.85, thread: 0.7, customer: 0.6, labels: 0.8, outcome: 0.4 };
const OUTCOMES = ["resolved", "resolved", "resolved", "handed off", "abandoned"];
// Test traffic the noise widget counts: an origin, or a non-production environment.
const NOISE_SHARE = {
  playground: 0.02,
  evaluation: 0.03,
  simulation: 0.02,
  staging: 0.03,
  test: 0.02,
};

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
let threadCounter = 0;

function makeThread() {
  threadCounter++;
  return {
    threadId: `demo-thread-${threadCounter}`,
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
  };
}

const THREAD_POOL = Array.from({ length: 120 }, makeThread);

function nextThread() {
  // reuse a thread with remaining capacity ~40% of the time, else start fresh
  const candidates = THREAD_POOL.filter((t) => t.used < t.size);
  if (candidates.length && rand() < 0.4) {
    const t = pick(candidates);
    t.used++;
    return t;
  }
  // Start fresh: a brand-new thread, never an already-exhausted one from the
  // pool. Picking an exhausted thread would push its `used` past `size` and
  // inflate avg_traces_per_thread — the default run emits far more traces than
  // the pool's capacity, so the pool is routinely exhausted here.
  const t = makeThread();
  t.used++;
  THREAD_POOL.push(t);
  return t;
}

function buildLlmSpan(spanId, isError, parentId) {
  const model = weightedPick(MODELS);
  const promptTokens = Math.round(lognormal(5.2, 0.6)); // ~ 100-400 typical
  const completionTokens = Math.round(lognormal(4.8, 0.7)); // ~ 60-350 typical
  const question = pick(USER_QUESTIONS);
  const answer = pick(ASSISTANT_ANSWERS);
  return {
    type: "llm",
    span_id: spanId,
    parent_id: parentId,
    name: "chat-completion",
    model,
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
    },
    ...(isError
      ? {
          error: {
            has_error: true,
            message: "upstream model request failed",
            stacktrace: [
              "Error: upstream model request failed",
              "    at chatCompletion (demo-traffic-seed.mjs:1:1)",
            ],
          },
        }
      : {}),
  };
}

function buildRagSpan(spanId, parentId) {
  return {
    type: "rag",
    span_id: spanId,
    parent_id: parentId,
    name: "retrieve-context",
    input: { type: "text", value: pick(USER_QUESTIONS) },
    output: {
      type: "text",
      value: `${pick(RAG_SNIPPETS)} ${pick(RAG_SNIPPETS)}`,
    },
  };
}

function buildToolSpan(spanId, parentId, isError = false) {
  return {
    type: "tool",
    span_id: spanId,
    parent_id: parentId,
    name: "lookup-account",
    input: { type: "text", value: "account_lookup" },
    output: { type: "text", value: isError ? "" : "found: true" },
    ...(isError
      ? { error: { has_error: true, message: "account service timed out", stacktrace: [] } }
      : {}),
  };
}

// The root span every step hangs under, so a step has a parent to recover in.
function buildAgentSpan(spanId, isError) {
  return {
    type: "agent",
    span_id: spanId,
    name: "support-agent",
    input: { type: "text", value: pick(USER_QUESTIONS) },
    output: { type: "text", value: isError ? "" : pick(ASSISTANT_ANSWERS) },
    ...(isError
      ? { error: { has_error: true, message: "upstream model request failed", stacktrace: [] } }
      : {}),
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
    const weight = activityWeight(t);
    if (rand() < weight) return t.getTime();
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

  const rootId = `${traceId}-agent`;
  const root = buildAgentSpan(rootId, isError);
  // deterministic composition: always >=1 llm step, optionally rag/tool; a failed
  // tool call that is retried is a failure the agent recovered from
  const steps = [];
  if (numSpans >= 2) steps.push(buildRagSpan(`${traceId}-rag-1`, rootId));
  if (numSpans >= 3) {
    if (rand() < 0.15) steps.push(buildToolSpan(`${traceId}-tool-0`, rootId, true));
    steps.push(buildToolSpan(`${traceId}-tool-1`, rootId));
  }
  steps.push(buildLlmSpan(`${traceId}-llm-1`, isError, rootId));
  if (numSpans >= 4) steps.push(buildLlmSpan(`${traceId}-llm-2`, false, rootId));

  // the root covers the trace; its steps run one after another inside it
  root.timestamps = { started_at: startedAtMs, finished_at: finishedAtMs };
  const step = Math.max(1, Math.floor(durationMs / steps.length));
  steps.forEach((span, i) => {
    const spanStart = startedAtMs + i * step;
    const spanEnd = i === steps.length - 1 ? finishedAtMs : spanStart + step;
    span.timestamps = { started_at: spanStart, finished_at: spanEnd };
  });

  const has = (field) => rand() < FIELD_SHARE[field];
  const environment = rand() < NOISE_SHARE.staging ? "staging" : undefined;
  return {
    trace_id: traceId,
    spans: [root, ...steps],
    metadata: {
      ...(has("user") ? { user_id: thread.userId } : {}),
      ...(has("thread") ? { thread_id: thread.threadId } : {}),
      ...(has("customer") ? { customer_id: thread.customerId } : {}),
      ...(has("labels") ? { labels: [...pick(LABEL_SETS), "demo-traffic-seed"] } : {}),
      ...(has("outcome") ? { outcome: pick(OUTCOMES) } : {}),
      ...(environment ? { environment } : {}),
    },
  };
}

// --- OTLP traces: the collector format cannot set an origin or a resource
// attribute, so test runs and test-environment traffic go in over OTLP.
const hex = (bytes) => crypto.randomBytes(bytes).toString("hex");
const str = (key, value) => ({ key, value: { stringValue: value } });
const int = (key, value) => ({ key, value: { intValue: String(value) } });
const nanos = (ms) => String(BigInt(ms) * 1000000n);

function buildOtlpTrace(finishedAtMs, { origin, environment }) {
  const traceId = hex(16);
  const rootId = hex(8);
  const durationMs = randInt(800, 6000);
  const startedAtMs = finishedAtMs - durationMs;
  const model = weightedPick(MODELS);
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            str("service.name", "support-agent"),
            ...(environment ? [str("deployment.environment", environment)] : []),
          ],
        },
        scopeSpans: [
          {
            scope: { name: "demo-traffic-seed" },
            spans: [
              {
                traceId,
                spanId: rootId,
                name: "support-agent",
                kind: 1,
                startTimeUnixNano: nanos(startedAtMs),
                endTimeUnixNano: nanos(finishedAtMs),
                attributes: [
                  str("langwatch.span.type", "agent"),
                  ...(origin ? [str("langwatch.origin", origin)] : []),
                ],
                status: { code: 1 },
              },
              {
                traceId,
                spanId: hex(8),
                parentSpanId: rootId,
                name: "chat-completion",
                kind: 3,
                startTimeUnixNano: nanos(startedAtMs + 100),
                endTimeUnixNano: nanos(finishedAtMs - 50),
                attributes: [
                  str("langwatch.span.type", "llm"),
                  str("gen_ai.request.model", model),
                  int("gen_ai.usage.input_tokens", Math.round(lognormal(5.2, 0.6))),
                  int("gen_ai.usage.output_tokens", Math.round(lognormal(4.8, 0.7))),
                ],
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };
}

/** A test run or test-environment trace, or nothing, in the shares NOISE_SHARE sets. */
function maybeNoiseTrace(finishedAtMs) {
  const roll = rand();
  let edge = 0;
  for (const origin of ["playground", "evaluation", "simulation"]) {
    edge += NOISE_SHARE[origin];
    if (roll < edge) return buildOtlpTrace(finishedAtMs, { origin });
  }
  edge += NOISE_SHARE.test;
  if (roll < edge) return buildOtlpTrace(finishedAtMs, { environment: "test" });
  return undefined;
}

// --- scenario runs: a few suites run every few days, so Release check has
// batches to compare; one scenario is flaky.
const SUITES = {
  "checkout-suite": [
    "refund a double charge",
    "cancel a plan",
    "change billing email",
    "explain an invoice",
    "apply a coupon",
  ],
  "account-suite": [
    "reset an API key",
    "invite a teammate",
    "set up SSO",
    "export traces",
    "rotate a webhook secret",
  ],
};
const FLAKY_SCENARIO = "apply a coupon";

function scenarioRunEvents({ suite, scenario, batchRunId, atMs }) {
  const scenarioRunId = `demo-run-${crypto.randomUUID()}`;
  const scenarioId = `demo-${scenario.replaceAll(" ", "-")}`;
  const base = { batchRunId, scenarioId, scenarioRunId, scenarioSetId: suite };
  const passRate = scenario === FLAKY_SCENARIO ? 0.5 : 0.92;
  const passed = rand() < passRate;
  const criterion = `The agent can ${scenario}`;
  const durationMs = randInt(4000, 25000);
  return [
    {
      ...base,
      type: "SCENARIO_RUN_STARTED",
      timestamp: atMs,
      metadata: { name: scenario, description: `The user asks the agent to ${scenario}.` },
    },
    {
      ...base,
      type: "SCENARIO_MESSAGE_SNAPSHOT",
      timestamp: atMs + durationMs - 10,
      messages: [
        { id: `${scenarioRunId}-u`, role: "user", content: `Can you ${scenario} for me?` },
        {
          id: `${scenarioRunId}-a`,
          role: "assistant",
          content: passed ? "Done." : "I cannot do that.",
        },
      ],
    },
    {
      ...base,
      type: "SCENARIO_RUN_FINISHED",
      timestamp: atMs + durationMs,
      status: passed ? "SUCCESS" : "FAILED",
      results: {
        verdict: passed ? "success" : "failure",
        reasoning: passed ? "The agent did what was asked." : "The agent refused.",
        metCriteria: passed ? [criterion] : [],
        unmetCriteria: passed ? [] : [criterion],
      },
    },
  ];
}

function scenarioBatches(now, dayMs) {
  const events = [];
  for (let d = DAYS - 1; d >= 0; d -= 3) {
    if (d === QUIET_DAYS_AGO) continue;
    for (const [suite, scenarios] of Object.entries(SUITES)) {
      const batchRunId = `demo-batch-${crypto.randomUUID()}`;
      const atMs = Math.min(now - 60_000, now - d * dayMs + randInt(0, 6) * 3_600_000);
      for (const scenario of scenarios) {
        events.push(scenarioRunEvents({ suite, scenario, batchRunId, atMs }));
      }
    }
  }
  return events;
}

async function postJson(path, body, { bearer = false } = {}) {
  const response = await fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: {
      "X-Auth-Token": apiKey,
      ...(bearer ? { Authorization: `Bearer ${apiKey}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${path} ${response.status}: ${await response.text()}`);
  }
}

/** One item: a collector trace, an OTLP trace or one scenario run's events in order. */
async function post(item) {
  if (item.kind === "otlp") return postJson("/api/otel/v1/traces", item.body, { bearer: true });
  if (item.kind === "scenario") {
    for (const event of item.body) await postJson("/api/scenario-events", event, { bearer: true });
    return;
  }
  return postJson("/api/collector", item.body);
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
  const items = [];

  for (let d = DAYS - 1; d >= 0; d--) {
    if (d === QUIET_DAYS_AGO) continue;
    const dayStart = new Date(now - d * dayMs);
    dayStart.setUTCHours(0, 0, 0, 0);
    // mild upward trend: more recent days get slightly more traffic
    const trend = 0.8 + 0.4 * ((DAYS - 1 - d) / Math.max(1, DAYS - 1));
    const jitter = 0.75 + rand() * 0.5; // +/-25%
    const dayOfWeek = dayStart.getUTCDay();
    const dayWeekdayFactor = dayOfWeek === 0 || dayOfWeek === 6 ? 0.5 : 1.0;
    const count = Math.max(1, Math.round(PER_DAY * trend * jitter * dayWeekdayFactor));
    for (let i = 0; i < count; i++) {
      const ts = Math.min(randomTimestampOnDay(dayStart.getTime()), now);
      const noise = maybeNoiseTrace(ts);
      items.push(
        noise ? { kind: "otlp", body: noise } : { kind: "collector", body: buildTrace(ts) },
      );
    }
  }
  for (const events of scenarioBatches(now, dayMs)) items.push({ kind: "scenario", body: events });
  const traces = items;

  console.log(
    `Seeding ${traces.length} synthetic traces and scenario runs over the last ${DAYS} days into ${endpoint} ...`,
  );

  const { succeeded, failed } = await runPool(traces, (item) => post(item), 5);

  const failRate = failed / traces.length;
  console.log(
    `Done. ${succeeded} succeeded, ${failed} failed, out of ${traces.length} total ` +
      `(days=${DAYS}, per_day~${PER_DAY}).`,
  );
  if (failRate > 0.02) {
    console.error(`Failure rate ${(failRate * 100).toFixed(1)}% exceeds 2% threshold.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
