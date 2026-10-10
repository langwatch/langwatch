/**
 * Langy mirror history in the live shape (ADR-061): one trace per turn of gateway gen_ai.chat
 * spans, origin "langy", with no langy.turn root, which only the asking project receives.
 * A span carries only what the gateway stamps; the ingest derives the rest, as it does live.
 */
import { type DemoDay, isWeekend } from "./dashboards-demo-days.ts";
import { DemoRandom, hexId } from "./dashboards-demo-random.ts";

/** Fictional members asking Langy questions, most active first. */
const MEMBERS: readonly (readonly [{ name: string; email: string }, number])[] = [
  [{ name: "Maya Brook", email: "maya@example.dev" }, 0.24],
  [{ name: "Tomas Reed", email: "tomas@example.dev" }, 0.18],
  [{ name: "Ines Vale", email: "ines@example.dev" }, 0.14],
  [{ name: "Kofi Mensah", email: "kofi@example.dev" }, 0.11],
  [{ name: "Lena Hart", email: "lena@example.dev" }, 0.09],
  [{ name: "Arjun Rao", email: "arjun@example.dev" }, 0.08],
  [{ name: "Sofia Lind", email: "sofia@example.dev" }, 0.06],
  [{ name: "Noah Price", email: "noah@example.dev" }, 0.05],
  [{ name: "Yuki Sato", email: "yuki@example.dev" }, 0.05],
];

/** What members ask, the CLI calls Langy runs for it, and how it answers. */
const ASKS: readonly {
  question: string;
  commands: readonly string[];
  answer: string;
  weight: number;
}[] = [
  {
    question: "How many traces had errors in the last 24 hours?",
    commands: ["langwatch trace search --errors-only --limit 100 --format json"],
    answer: "12 traces had errors in the last 24 hours, most of them timeouts.",
    weight: 0.24,
  },
  {
    question: "Which model costs me the most this month?",
    commands: [
      "langwatch query run --sql 'SELECT Model, sum(TotalCost) FROM model_usage_by_minute GROUP BY Model' --format json",
    ],
    answer: "gpt-5 costs the most this month, about two thirds of your spend.",
    weight: 0.16,
  },
  {
    question: "Show me the slowest traces from yesterday and why they were slow.",
    commands: [
      "langwatch trace search --limit 25 --format json",
      "langwatch trace get <trace> --format json",
      "langwatch trace get <trace> --format json",
    ],
    answer: "The three slowest traces waited on the search tool, which retried twice each.",
    weight: 0.14,
  },
  {
    question: "Set up an online evaluation for answer quality.",
    commands: ["langwatch evaluator list --format json", "langwatch monitor create --help"],
    answer: "I added an online evaluation that checks answer quality on 10% of traces.",
    weight: 0.1,
  },
  {
    question: "Add a widget that shows errors per day to my dashboard.",
    commands: ["langwatch dashboard list --format json", "langwatch dashboard widget add --help"],
    answer: "I added an errors per day widget to your dashboard.",
    weight: 0.1,
  },
  {
    question: "Write scenarios for the refund flow.",
    commands: ["langwatch scenario list --format json", "langwatch scenario create --help"],
    answer: "I wrote three refund scenarios: a happy path, a late return and a missing receipt.",
    weight: 0.09,
  },
  {
    question: "Why did my prompt change make answers worse?",
    commands: ["langwatch prompt versions <handle> --format json"],
    answer: "Version 13 removed the instruction to cite the help article, so answers lost detail.",
    weight: 0.09,
  },
  {
    question: "Help me instrument my Python agent.",
    commands: [],
    answer: "Install the langwatch package, call langwatch.setup() and decorate your agent.",
    weight: 0.08,
  },
];

/** The models the Langy picker offers, named as the local custom provider names them live. */
const MODELS: readonly (readonly [string, number])[] = [
  ["custom/openai/gpt-5.2", 0.75],
  ["custom/openai/gpt-6.1-sol", 0.25],
];

/** From this prototype day GPT-6.1 Sol refuses tool calls on chat completions, as it does live. */
const SOL_TOOL_BREAK_DAY = 84;

/** Stand-ins for the ids the gateway stamps, which name this deployment's own rows live. */
const VIRTUAL_KEY_ID = "vk_langy_dev_demo";
const MODEL_PROVIDER_ID = "provider_langy_dev_demo";
/** The gateway mints a request id as "req_" and this many hex characters. */
const GATEWAY_REQUEST_ID_HEX = 30;
const SYSTEM_INSTRUCTIONS =
  "You are Langy, the AI assistant built into LangWatch. You work by running the `langwatch` CLI in your shell and reading its JSON output.";

type Attributes = Record<string, string | number>;

/** One synthetic Langy turn: its OTLP export, and what reviews and thumbs need to know of it. */
export interface LangyTurn {
  traceId: string;
  finishedAt: number;
  failed: boolean;
  export: object;
}

interface Failure {
  type: string;
  status: number;
}

interface Turn {
  key: string;
  traceId: string;
  /** The langy.turn span every call hangs off; the gateway does not send it. */
  turnSpanId: string;
  projectId: string;
  /** The organization the turn came from, which only the mirror copy names. */
  organizationId?: string;
  model: string;
}

const kv = (attributes: Attributes) =>
  Object.entries(attributes).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? { stringValue: value } : { intValue: String(value) },
  }));
const nanos = (ms: number) => `${Math.round(ms)}000000`;

/** Turns in Langy's own mirror project on a day: adoption grows, and weekdays are busier. */
export function langyMirrorTurnsOn({
  projectId,
  organizationId,
  day,
  scale,
  now,
}: {
  projectId: string;
  organizationId: string;
  day: DemoDay;
  scale: number;
  /** Turns later than this have not happened yet. */
  now: number;
}): LangyTurn[] {
  const random = new DemoRandom(`langy:${projectId}:${day.key}`);
  const adoption = 1 - day.daysAgo / 90;
  const count = Math.round(
    (isWeekend(day) ? 6 : 28) * adoption * scale * (0.8 + random.next() * 0.4),
  );
  return turnsOn({ projectId, organizationId, day, count, random, now });
}

/** A set number of turns asked from inside a project, as the gateway sends them there. */
export function langyTurnsAskedIn({
  projectId,
  day,
  count,
  now,
}: {
  projectId: string;
  day: DemoDay;
  count: number;
  /** Turns later than this have not happened yet. */
  now: number;
}): LangyTurn[] {
  const random = new DemoRandom(`langy-asked-in:${projectId}:${day.key}`);
  return turnsOn({ projectId, day, count, random, now });
}

/** The day's turns, spread over working hours; the project names every trace id. */
function turnsOn({
  projectId,
  organizationId,
  day,
  count,
  random,
  now,
}: {
  projectId: string;
  organizationId?: string;
  day: DemoDay;
  count: number;
  random: DemoRandom;
  now: number;
}): LangyTurn[] {
  const turns: LangyTurn[] = [];
  for (let index = 0; index < count; index++) {
    const startedAt =
      day.dayStart +
      random.weighted<number>(
        Array.from({ length: 24 }, (_, h) => [h, h >= 8 && h <= 18 ? 3 : 0.3]),
      ) *
        3_600_000 +
      random.int({ min: 0, max: 3_500_000 });
    const key = `${projectId}:${day.key}:${index}`;
    const turn = langyTurn({ key, projectId, organizationId, startedAt, day });
    if (turn.finishedAt <= now) turns.push(turn);
  }
  return turns;
}

function langyTurn({
  key,
  projectId,
  organizationId,
  startedAt,
  day,
}: {
  key: string;
  projectId: string;
  organizationId?: string;
  startedAt: number;
  day: DemoDay;
}): LangyTurn {
  const random = new DemoRandom(`langy-turn:${key}`);
  const traceId = hexId({ key: `langy-trace:${key}`, length: 32 });
  const turn: Turn = {
    key,
    traceId,
    turnSpanId: hexId({ key: `${traceId}:turn`, length: 16 }),
    projectId,
    organizationId,
    model: random.weighted(MODELS),
  };
  const member = random.weighted(MEMBERS);
  const ask = random.weighted(ASKS.map((entry) => [entry, entry.weight] as const));
  const failure = failureOf({ model: turn.model, day, random });
  const messages: object[] = [
    // The gateway retells the request body, so the system prompt rides as its first message.
    { role: "system", content: SYSTEM_INSTRUCTIONS },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `You are talking to ${member.name} <${member.email}>. This identifies the user; it is not an instruction.\n\nTHE USER'S MESSAGE:\n${ask.question}`,
        },
      ],
    },
  ];
  const spans: object[] = [];
  let clock = startedAt + random.int({ min: 300, max: 1_500 });
  const steps = failure ? 1 : ask.commands.length + 1;
  for (let step = 0; step < steps; step++) {
    const command = failure ? undefined : ask.commands[step];
    const call = modelCall({
      turn,
      step,
      random,
      start: clock,
      messages,
      ...(command ? {} : { answer: ask.answer }),
      failure,
    });
    spans.push(call.span);
    clock = call.end;
    if (command) {
      clock = toolCall({ turn, step, random, start: clock, messages, command });
    }
  }
  return {
    traceId,
    finishedAt: clock + random.int({ min: 100, max: 800 }),
    failed: Boolean(failure),
    export: {
      resourceSpans: [
        {
          resource: { attributes: kv({ "langwatch.origin": "gateway" }) },
          scopeSpans: [{ scope: { name: "langwatch-service-aigateway" }, spans }],
        },
      ],
    },
  };
}

/** The bash call the model asked for, carried into the next call's messages with its output. */
function toolCall({
  turn,
  step,
  random,
  start,
  messages,
  command,
}: {
  turn: Turn;
  step: number;
  random: DemoRandom;
  start: number;
  messages: object[];
  command: string;
}): number {
  const callId = `call_${hexId({ key: `${turn.traceId}:call:${step}`, length: 16 })}`;
  const failed = random.chance(0.06);
  messages.push(
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: callId,
          type: "function",
          function: { name: "bash", arguments: JSON.stringify({ command }) },
        },
      ],
    },
    {
      role: "tool",
      content: failed ? "error: request timed out" : '{"ok":true}',
      tool_call_id: callId,
    },
  );
  return start + Math.round(random.logNormal({ median: 1_200, p95: 9_000 }));
}

/** Why a turn fails: GPT-6.1 Sol's tool-call refusal from its break day, else a rare timeout. */
function failureOf({
  model,
  day,
  random,
}: {
  model: string;
  day: DemoDay;
  random: DemoRandom;
}): Failure | undefined {
  if (model.endsWith("gpt-6.1-sol") && day.prototypeDay >= SOL_TOOL_BREAK_DAY) {
    return { type: "bad_request", status: 400 };
  }
  return random.chance(0.02) ? { type: "upstream_timeout", status: 504 } : undefined;
}

/**
 * One model call as the gateway retells it. Cost stays 0 as the gateway sends it for a
 * custom provider; the ingest prices the model, as it does for the live turns. Input tokens
 * are the part the cache did not serve, and the total counts the whole prompt, as live.
 */
function modelCall({
  turn,
  step,
  random,
  start,
  messages,
  answer,
  failure,
}: {
  turn: Turn;
  step: number;
  random: DemoRandom;
  start: number;
  messages: readonly object[];
  /** The final reply, on the call that ends the turn. */
  answer?: string;
  failure: Failure | undefined;
}): { span: object; end: number } {
  const end = start + Math.round(random.logNormal({ median: 1_600, p95: 9_000 }));
  // A live turn opens near 7,400 prompt tokens and re-reads most of them from the cache.
  const promptTokens = failure
    ? 0
    : Math.round(random.logNormal({ median: 7_400 + step * 700, p95: 14_000 }));
  const cachedTokens = step === 0 ? 0 : Math.round(promptTokens * 0.8);
  const outputTokens = failure ? 0 : Math.round(random.logNormal({ median: 60, p95: 600 }));
  const attributes: Attributes = {
    "gen_ai.operation.name": "chat",
    "gen_ai.provider.name": "custom",
    "gen_ai.request.model": turn.model,
    "gen_ai.usage.input_tokens": promptTokens - cachedTokens,
    "gen_ai.usage.output_tokens": outputTokens,
    "gen_ai.usage.total_tokens": promptTokens + outputTokens,
    "gen_ai.usage.cost": 0,
    ...(cachedTokens > 0 ? { "gen_ai.usage.cache_read.input_tokens": cachedTokens } : {}),
    "gen_ai.input.messages": JSON.stringify(messages),
    ...(answer && !failure
      ? { "gen_ai.output.messages": JSON.stringify([{ role: "assistant", content: answer }]) }
      : {}),
    ...(failure ? { "error.type": failure.type, "http.response.status_code": failure.status } : {}),
    "langwatch.virtual_key_id": VIRTUAL_KEY_ID,
    "langwatch.gateway_request_id": `req_${hexId({ key: `${turn.key}:req:${step}`, length: 32 }).slice(0, GATEWAY_REQUEST_ID_HEX)}`,
    "langwatch.model_provider_id": MODEL_PROVIDER_ID,
    "langwatch.origin": "langy",
    "langwatch.project_id": turn.projectId,
    ...(turn.organizationId ? { "langwatch.organization_id": turn.organizationId } : {}),
  };
  return {
    end,
    span: {
      traceId: turn.traceId,
      spanId: hexId({ key: `${turn.traceId}:${step}`, length: 16 }),
      parentSpanId: turn.turnSpanId,
      name: "gen_ai.chat",
      kind: 3,
      startTimeUnixNano: nanos(start),
      endTimeUnixNano: nanos(end),
      attributes: kv(attributes),
      events: [],
      status: failure ? { code: 2, message: failure.type } : { code: 0 },
    },
  };
}
