/**
 * Coding-agent sessions for the dashboards demo, as the agents export them over OTLP: Claude
 * Code sends a span per model call and events per prompt and request; Claude Cowork sends
 * events only. A LangWatch hook event names each session's repository and branch.
 */
import { type DemoDay, isWeekend } from "./dashboards-demo-days.ts";
import type { DashboardsDemoAgent } from "./dashboards-demo-ids.ts";
import { DemoRandom, hexId } from "./dashboards-demo-random.ts";
import { MODEL_PRICES } from "./dashboards-demo-traffic.ts";

/** How each demo coding agent reports itself; the service name is what the stack detects. */
const TOOLS: Record<string, { serviceName: string; eventPrefix: string; sendsSpans: boolean }> = {
  "code-helper": { serviceName: "claude-code", eventPrefix: "claude_code.", sendsSpans: true },
  "ops-cowork": { serviceName: "claude-cowork", eventPrefix: "claude_cowork.", sendsSpans: false },
};

const DEVELOPERS = ["ana@example.dev", "bo@example.dev", "chidi@example.dev", "dara@example.dev"];
const REPOSITORIES = ["storefront", "checkout-service", "support-console"];
const BRANCHES = [
  "fix/refund-rounding",
  "feat/size-guide",
  "chore/upgrade-sdk",
  "feat/order-tracking",
];
const MODELS: [string, number][] = [
  ["claude-sonnet-4-5", 0.7],
  ["claude-haiku-4-5", 0.3],
];
const PROMPTS = [
  "Add a test for the refund rounding bug",
  "Explain why the checkout total is off by one cent",
  "Rename the size guide component and update its imports",
];

type Attributes = Record<string, string | number>;

/** One session's OTLP bodies, with the ids a re-run needs to leave out what is already held. */
export interface CodingSession {
  sessionId: string;
  traceId: string;
  startedAt: number;
  /** Empty for an agent that sends events only. */
  traces: object[];
  logs: object[];
}

const kv = (attributes: Attributes) =>
  Object.entries(attributes).map(([key, value]) => ({
    key,
    value: typeof value === "number" ? { doubleValue: value } : { stringValue: value },
  }));
const nanos = (ms: number) => `${Math.round(ms)}000000`;

/** Sessions for one coding agent on one day, ids fixed by day. */
export function codingSessionsOn({
  agent,
  projectSlug,
  day,
  scale,
  now,
}: {
  agent: DashboardsDemoAgent;
  projectSlug: string;
  day: DemoDay;
  scale: number;
  /** Sessions later than this have not happened yet. */
  now: number;
}): CodingSession[] {
  const tool = TOOLS[agent.name];
  if (!tool) throw new Error(`No coding tool is set for the demo agent ${agent.name}`);
  const random = new DemoRandom(`${projectSlug}:${agent.name}:${day.key}:sessions`);
  const sessions = Math.max(
    1,
    Math.round((isWeekend(day) ? 2 : 9) * scale * (0.7 + random.next() * 0.6)),
  );
  const made: CodingSession[] = [];
  for (let index = 0; index < sessions; index++) {
    const startedAt =
      day.dayStart +
      random.int({ min: 8, max: 18 }) * 3_600_000 +
      random.int({ min: 0, max: 3_000_000 });
    // A session can run for hours, so one that might still be going is left out.
    if (startedAt + 3 * 3_600_000 > now) continue;
    made.push(
      sessionOf({
        tool,
        agent,
        key: `${projectSlug}:${agent.name}:${day.key}:${index}`,
        startedAt,
      }),
    );
  }
  return made;
}

function sessionOf({
  tool,
  agent,
  key,
  startedAt,
}: {
  tool: (typeof TOOLS)[string];
  agent: DashboardsDemoAgent;
  key: string;
  startedAt: number;
}): CodingSession {
  const random = new DemoRandom(key);
  const sessionId = hexId({ key: `session:${key}`, length: 32 });
  const traceId = hexId({ key: `coding-trace:${key}`, length: 32 });
  const identity: Attributes = {
    "session.id": sessionId,
    "user.email": random.pick(DEVELOPERS),
    "gen_ai.agent.name": agent.name,
  };
  const event = (name: string, at: number, attributes: Attributes) => ({
    timeUnixNano: nanos(at),
    body: { stringValue: `${tool.eventPrefix}${name}` },
    attributes: kv({ ...identity, "event.name": `${tool.eventPrefix}${name}`, ...attributes }),
  });
  const repository = random.pick(REPOSITORIES);
  const records = [];
  const hookRecords = [
    {
      timeUnixNano: nanos(startedAt),
      body: { stringValue: "langwatch.session_context" },
      attributes: kv({
        ...identity,
        "event.name": "langwatch.session_context",
        "vcs.repository.host": "github.com",
        "vcs.repository.owner": "example-shop",
        "vcs.repository.name": repository,
        "vcs.ref.head.name": random.pick(BRANCHES),
      }),
    },
  ];
  const spans = [];
  let clock = startedAt;
  const prompts = random.int({ min: 1, max: 6 });
  for (let prompt = 0; prompt < prompts; prompt++) {
    records.push(
      event("user_prompt", clock, {
        prompt_length: random.int({ min: 20, max: 400 }),
        prompt: random.pick(PROMPTS),
      }),
    );
    const calls = random.int({ min: 2, max: 9 });
    for (let call = 0; call < calls; call++) {
      const model = random.weighted(MODELS);
      const durationMs = Math.round(random.logNormal({ median: 4_000, p95: 20_000 }));
      const inputTokens = Math.round(random.logNormal({ median: 9_000, p95: 60_000 }));
      const outputTokens = Math.round(random.logNormal({ median: 600, p95: 4_000 }));
      const [inputPrice, outputPrice] = MODEL_PRICES[model] ?? [3, 15];
      const cost = (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000;
      const request: Attributes = {
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        duration_ms: durationMs,
        cost_usd: Math.round(cost * 1e6) / 1e6,
      };
      if (random.chance(0.006)) {
        records.push(
          event("api_error", clock + durationMs, {
            model,
            status_code: "529",
            error: "Overloaded",
          }),
        );
      }
      records.push(event("api_request", clock + durationMs, request));
      if (tool.sendsSpans) {
        spans.push({
          traceId,
          spanId: hexId({ key: `${key}:${prompt}:${call}`, length: 16 }),
          name: "claude_code.llm_request",
          kind: 1,
          startTimeUnixNano: nanos(clock),
          endTimeUnixNano: nanos(clock + durationMs),
          attributes: kv({ ...identity, ...request }),
          status: { code: 1 },
        });
      }
      clock += durationMs + random.int({ min: 500, max: 30_000 });
    }
    clock += random.int({ min: 30_000, max: 600_000 });
  }
  const resource = { attributes: kv({ "service.name": tool.serviceName }) };
  return {
    sessionId,
    traceId,
    startedAt,
    traces:
      spans.length > 0
        ? [
            {
              resourceSpans: [
                { resource, scopeSpans: [{ scope: { name: tool.serviceName }, spans }] },
              ],
            },
          ]
        : [],
    logs: [
      {
        resourceLogs: [
          {
            resource,
            scopeLogs: [
              { scope: { name: `com.anthropic.${tool.eventPrefix}events` }, logRecords: records },
              { scope: { name: "langwatch.coding_agent.hook" }, logRecords: hookRecords },
            ],
          },
        ],
      },
    ],
  };
}
