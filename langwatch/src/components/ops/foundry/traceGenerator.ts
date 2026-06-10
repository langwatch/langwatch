import { shortId } from "./types";
import type { SpanConfig, SpanType, TraceConfig } from "./types";

export interface PromptRef {
  id: string;
  /** Numeric version. Surfaced as `langwatch.prompt.version.number` on the
   * emitted span so the trace-summary projection can populate the
   * `LastUsedPromptVersionNumber` column without parsing the shorthand. */
  version: number;
  versionId: string;
  handle: string | null;
  model?: string;
  inputs: Array<{ identifier: string; type: string }>;
}

export interface GeneratorOptions {
  targetSpanCount: number;
  maxDepth: number;
  genaiRatio: number; // 0.0–1.0: fraction of spans that are genai-typed
  /** When non-empty, llm spans randomly attach a real prompt id/version/variables. */
  prompts?: PromptRef[];
  /** When true, attach OTel semconv span events (gen_ai.*.message, exceptions, logs). */
  includeEvents?: boolean;
}

const GENAI_TYPES: SpanType[] = ["llm", "agent", "tool", "rag", "chain", "guardrail"];
const INFRA_TYPES: SpanType[] = ["server", "client", "span", "task", "component", "module"];

const MODEL_NAMES = [
  "gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini",
  "claude-sonnet-4-5-20250514", "claude-haiku-4-5-20251001",
  "gemini-2.5-pro", "gemini-2.5-flash",
];

const TOOL_NAMES = [
  "search_documents", "get_weather", "execute_sql", "send_email",
  "create_ticket", "lookup_user", "calculate", "fetch_url",
  "list_files", "run_code", "translate_text", "summarize",
];

const AGENT_NAMES = [
  "orchestrator", "researcher", "planner", "coder", "reviewer",
  "analyst", "writer", "validator", "router", "extractor",
];

const SYSTEM_PROMPTS = [
  "You are a helpful assistant that answers questions accurately.",
  "You are a research agent. Find relevant information and summarize it.",
  "You are a code reviewer. Analyze the code and provide feedback.",
  "You are a planning agent. Break down tasks into actionable steps.",
  "You are a data analyst. Interpret the data and provide insights.",
];

const USER_MESSAGES = [
  "Can you help me understand the quarterly revenue trends?",
  "Search for recent papers on transformer architectures.",
  "What's the current status of ticket PROJ-1234?",
  "Summarize the key findings from the latest report.",
  "Generate a SQL query to find all users who signed up last month.",
  "Review the pull request and highlight any security concerns.",
  "What are the top 5 action items from yesterday's meeting?",
  "Translate this document from English to Spanish.",
  "Calculate the total cost including tax and shipping.",
  "Find all files modified in the last 24 hours.",
];

const ASSISTANT_RESPONSES = [
  "Based on my analysis, the quarterly revenue shows a 15% increase compared to last quarter, driven primarily by new enterprise contracts.",
  "I found 3 relevant papers. The most notable one proposes a sparse attention mechanism that reduces compute by 40%.",
  "Ticket PROJ-1234 is currently in review. It was last updated 2 hours ago by the engineering team.",
  "The report highlights three key findings: improved customer retention, higher NPS scores, and reduced churn in the enterprise segment.",
  "Here's the SQL query: SELECT * FROM users WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')",
  "I've identified two potential security concerns: an unsanitized user input on line 45 and a missing CSRF token check.",
  "The top 5 action items are: 1) Finalize Q3 roadmap, 2) Schedule design review, 3) Update documentation, 4) Fix CI pipeline, 5) Deploy hotfix.",
  "Translation complete. The document has been translated maintaining the original formatting and technical terminology.",
  "The total comes to $1,247.83 including 8.5% sales tax and $12.99 standard shipping.",
  "Found 47 files modified in the last 24 hours across 12 directories. Most changes are in the src/components/ directory.",
];

const RAG_CONTENTS = [
  "The system architecture uses a microservices pattern with event-driven communication between services.",
  "According to the policy document, all data must be encrypted at rest using AES-256 encryption.",
  "The API rate limit is set to 1000 requests per minute per API key for standard tier users.",
  "Performance benchmarks show that the new indexing strategy reduces query latency by 60%.",
  "The deployment pipeline consists of three stages: build, test, and deploy with automatic rollback on failure.",
];

const INFRA_SPAN_NAMES = [
  "http.request", "db.query", "cache.lookup", "auth.verify",
  "rate_limit.check", "metrics.record", "log.flush", "config.load",
  "health.check", "middleware.cors", "middleware.auth", "serialise",
  "deserialise", "validate.input", "compress.response",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randInt(min: number, max: number): number {
  const range = max - min + 1;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return min + (buf[0]! % range);
}

function makeExceptionEvent(
  durationMs: number,
  message: string,
): NonNullable<SpanConfig["events"]>[number] {
  return {
    name: "exception",
    offsetMs: Math.max(1, durationMs - randInt(1, 5)),
    attributes: {
      "exception.type": pick([
        "TimeoutError",
        "RateLimitError",
        "ValidationError",
        "TypeError",
      ]),
      "exception.message": message,
      "exception.stacktrace": `Error: ${message}\n    at handleRequest (server.ts:${randInt(10, 500)})\n    at process (worker.ts:${randInt(10, 200)})`,
    },
  };
}

function makeInfraSpan(includeEvents?: boolean): SpanConfig {
  const status = Math.random() < 0.02 ? "error" : "ok";
  const durationMs = randInt(1, 30);
  const span: SpanConfig = {
    id: shortId(),
    name: pick(INFRA_SPAN_NAMES),
    type: pick(INFRA_TYPES),
    durationMs,
    offsetMs: 0,
    status,
    children: [],
    attributes: {
      "http.method": "POST",
      "http.status_code": 200,
    },
  };
  if (includeEvents && status === "error") {
    span.events = [makeExceptionEvent(durationMs, "Upstream call failed")];
  }
  return span;
}

function synthesizePromptVariables(
  inputs: PromptRef["inputs"],
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const { identifier, type } of inputs) {
    switch (type) {
      case "str":
        vars[identifier] = pick(USER_MESSAGES);
        break;
      case "float":
      case "int":
        vars[identifier] = String(randInt(1, 100));
        break;
      case "bool":
        vars[identifier] = Math.random() < 0.5 ? "true" : "false";
        break;
      case "list[str]":
        vars[identifier] = JSON.stringify([pick(USER_MESSAGES), pick(USER_MESSAGES)]);
        break;
      default:
        vars[identifier] = `synthetic-${identifier}`;
    }
  }
  return vars;
}

function makeLlmSpan(prompts?: PromptRef[], includeEvents?: boolean): SpanConfig {
  const promptRef =
    prompts && prompts.length > 0 && Math.random() < 0.7 ? pick(prompts) : null;
  const model = promptRef?.model ?? pick(MODEL_NAMES);
  const userMsg = pick(USER_MESSAGES);
  const assistantMsg = pick(ASSISTANT_RESPONSES);
  const systemPrompt = pick(SYSTEM_PROMPTS);
  const promptTokens = randInt(50, 800);
  const completionTokens = randInt(20, 600);
  const durationMs = randInt(200, 3000);
  const status = Math.random() < 0.03 ? "error" : "ok";

  const span: SpanConfig = {
    id: shortId(),
    name: `chat ${model}`,
    type: "llm",
    durationMs,
    offsetMs: 0,
    status,
    children: [],
    attributes: {},
    llm: {
      requestModel: model,
      responseModel: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
        { role: "assistant", content: assistantMsg },
      ],
      temperature: Math.random() < 0.5 ? 0.7 : 0,
      stream: Math.random() < 0.4,
      metrics: {
        promptTokens,
        completionTokens,
        cost: (promptTokens * 0.000003 + completionTokens * 0.000015),
      },
    },
    input: {
      type: "chat_messages",
      value: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
      ],
    },
    output: { type: "text", value: assistantMsg },
  };

  // gen_ai.* message + choice events are auto-emitted by the executor
  // from `llm.messages`, so we only attach an exception event here when
  // we want one — no need to duplicate the chat envelope as DSL events.
  if (includeEvents && status === "error") {
    span.events = [makeExceptionEvent(durationMs, "Provider returned 500")];
  }

  if (promptRef) {
    span.prompt = {
      // Prefer the human-readable handle so chip labels read clean
      // ("refund-policy v3"), fall back to the db id when older test
      // data didn't carry one.
      promptId: promptRef.handle ?? promptRef.id,
      version: promptRef.version,
      versionId: promptRef.versionId,
      variables: synthesizePromptVariables(promptRef.inputs),
    };
  }

  return span;
}

function makeToolSpan(includeEvents?: boolean): SpanConfig {
  const toolName = pick(TOOL_NAMES);
  const durationMs = randInt(10, 500);
  const status = Math.random() < 0.05 ? "error" : "ok";
  const span: SpanConfig = {
    id: shortId(),
    name: toolName,
    type: "tool",
    durationMs,
    offsetMs: 0,
    status,
    children: [],
    attributes: {},
    input: { type: "json", value: { query: "example input", limit: 10 } },
    output: { type: "json", value: { results: ["item1", "item2"], count: 2 } },
  };
  if (includeEvents && status === "error") {
    span.events = [makeExceptionEvent(durationMs, `${toolName} invocation failed`)];
  }
  return span;
}

function makeRagSpan(): SpanConfig {
  const numContexts = randInt(1, 4);
  return {
    id: shortId(),
    name: "retrieval",
    type: "rag",
    durationMs: randInt(50, 400),
    offsetMs: 0,
    status: "ok",
    children: [],
    attributes: {},
    rag: {
      contexts: Array.from({ length: numContexts }, (_, i) => ({
        document_id: `doc-${randInt(1, 200)}`,
        chunk_id: `chunk-${randInt(1, 50)}`,
        content: pick(RAG_CONTENTS),
      })),
    },
    input: { type: "text", value: pick(USER_MESSAGES) },
    output: { type: "json", value: { num_results: numContexts } },
  };
}

function makeGuardrailSpan(includeEvents?: boolean): SpanConfig {
  const passed = Math.random() < 0.9;
  const durationMs = randInt(5, 80);
  const span: SpanConfig = {
    id: shortId(),
    name: pick(["pii_check", "toxicity_filter", "jailbreak_detector", "content_policy"]),
    type: "guardrail",
    durationMs,
    offsetMs: 0,
    status: passed ? "ok" : "error",
    children: [],
    attributes: {},
    input: { type: "text", value: "Content to check" },
    output: { type: "json", value: { passed, score: Math.random().toFixed(3) } },
    ...(passed ? {} : {
      exception: { message: "Content policy violation detected" },
    }),
  };
  if (includeEvents && !passed) {
    span.events = [
      makeExceptionEvent(durationMs, "Content policy violation detected"),
    ];
  }
  return span;
}

/**
 * Recursively builds a span tree targeting a specific span count.
 *
 * Strategy:
 * - At each level, pick a "pattern" (agent loop, rag pipeline, workflow, etc.)
 * - Fill children until we approach the target budget
 * - Recurse into children that can hold more children
 */
interface SubtreeArgs {
  budget: number;
  depth: number;
  maxDepth: number;
  genaiRatio: number;
  prompts?: PromptRef[];
  includeEvents?: boolean;
}

interface StepResult {
  span: SpanConfig;
  used: number;
}

function appendLeafStep(
  isGenai: boolean,
  args: SubtreeArgs,
): StepResult {
  const { prompts, includeEvents } = args;
  if (!isGenai) return { span: makeInfraSpan(includeEvents), used: 1 };
  const leafType = Math.random();
  if (leafType < 0.4) return { span: makeLlmSpan(prompts, includeEvents), used: 1 };
  if (leafType < 0.6) return { span: makeToolSpan(includeEvents), used: 1 };
  if (leafType < 0.8) return { span: makeRagSpan(), used: 1 };
  return { span: makeGuardrailSpan(includeEvents), used: 1 };
}

function appendAgentLoopStep(remaining: number, args: SubtreeArgs): StepResult {
  const { depth, maxDepth, genaiRatio, prompts, includeEvents } = args;
  const agentName = pick(AGENT_NAMES);
  const loopIterations = Math.min(randInt(1, 4), Math.floor((remaining - 1) / 3));
  const agent: SpanConfig = {
    id: shortId(),
    name: agentName,
    type: "agent",
    durationMs: 0, // computed after children
    offsetMs: 0,
    status: "ok",
    children: [],
    attributes: {},
    input: { type: "text", value: pick(USER_MESSAGES) },
    output: { type: "text", value: pick(ASSISTANT_RESPONSES) },
  };
  let used = 1;

  let childBudget = Math.min(remaining - 1, randInt(3, Math.max(3, Math.floor(remaining * 0.4))));

  for (let i = 0; i < loopIterations && childBudget > 0; i++) {
    // LLM call
    agent.children.push(makeLlmSpan(prompts, includeEvents));
    childBudget--;
    used++;

    // Tool calls (1-3)
    const toolCount = Math.min(randInt(1, 3), childBudget);
    for (let t = 0; t < toolCount; t++) {
      agent.children.push(makeToolSpan(includeEvents));
      childBudget--;
      used++;
    }
  }

  // Possibly recurse sub-agents or deeper structures
  if (childBudget > 2 && depth < maxDepth - 2) {
    const sub = buildSubtree({
      budget: childBudget,
      depth: depth + 1,
      maxDepth,
      genaiRatio,
      prompts,
      includeEvents,
    });
    agent.children.push(...sub.spans);
    used += sub.used;
  }

  // Compute agent duration from children
  agent.durationMs = agent.children.reduce((sum, c) => sum + c.durationMs, 0) + randInt(10, 50);
  return { span: agent, used };
}

function appendRagPipelineStep(remaining: number, args: SubtreeArgs): StepResult {
  const { depth, maxDepth, genaiRatio, prompts, includeEvents } = args;
  const chain: SpanConfig = {
    id: shortId(),
    name: "rag-pipeline",
    type: "chain",
    durationMs: 0,
    offsetMs: 0,
    status: "ok",
    children: [],
    attributes: {},
    input: { type: "text", value: pick(USER_MESSAGES) },
    output: { type: "text", value: pick(ASSISTANT_RESPONSES) },
  };
  let used = 1;

  chain.children.push(makeRagSpan());
  used++;

  // Optional guardrail before generation
  if (Math.random() < 0.3 && remaining > 4) {
    chain.children.push(makeGuardrailSpan(includeEvents));
    used++;
  }

  chain.children.push(makeLlmSpan(prompts, includeEvents));
  used++;

  const childBudget = Math.min(remaining - used, randInt(0, 5));
  if (childBudget > 0 && depth < maxDepth - 1) {
    const sub = buildSubtree({
      budget: childBudget,
      depth: depth + 1,
      maxDepth,
      genaiRatio,
      prompts,
      includeEvents,
    });
    chain.children.push(...sub.spans);
    used += sub.used;
  }

  chain.durationMs = chain.children.reduce((sum, c) => sum + c.durationMs, 0) + randInt(5, 20);
  return { span: chain, used };
}

function appendWorkflowStep(remaining: number, args: SubtreeArgs): StepResult {
  const { depth, maxDepth, genaiRatio, prompts, includeEvents } = args;
  const workflow: SpanConfig = {
    id: shortId(),
    name: pick(["process_request", "handle_query", "run_pipeline", "execute_workflow"]),
    type: "workflow",
    durationMs: 0,
    offsetMs: 0,
    status: "ok",
    children: [],
    attributes: {},
  };
  let used = 1;

  const childBudget = Math.min(remaining - 1, randInt(2, Math.max(2, Math.floor(remaining * 0.3))));
  const sub = buildSubtree({
    budget: childBudget,
    depth: depth + 1,
    maxDepth,
    genaiRatio,
    prompts,
    includeEvents,
  });
  workflow.children = sub.spans;
  used += sub.used;

  workflow.durationMs = workflow.children.reduce((sum, c) => sum + c.durationMs, 0) + randInt(5, 30);
  return { span: workflow, used };
}

function appendSingleLeafStep(isGenai: boolean, args: SubtreeArgs): StepResult {
  const { prompts, includeEvents } = args;
  if (!isGenai) return { span: makeInfraSpan(includeEvents), used: 1 };
  const leafType = Math.random();
  if (leafType < 0.5) return { span: makeLlmSpan(prompts, includeEvents), used: 1 };
  if (leafType < 0.75) return { span: makeToolSpan(includeEvents), used: 1 };
  return { span: makeRagSpan(), used: 1 };
}

/**
 * Recursively builds a span tree targeting a specific span count.
 *
 * Strategy:
 * - At each level, pick a "pattern" (agent loop, rag pipeline, workflow, etc.)
 * - Fill children until we approach the target budget
 * - Recurse into children that can hold more children
 */
function buildSubtree(args: SubtreeArgs): { spans: SpanConfig[]; used: number } {
  const { budget, depth, maxDepth, genaiRatio } = args;
  if (budget <= 0 || depth >= maxDepth) return { spans: [], used: 0 };

  const spans: SpanConfig[] = [];
  let used = 0;

  while (used < budget) {
    const remaining = budget - used;

    const isGenai = Math.random() < genaiRatio;
    const atMaxDepth = depth >= maxDepth - 1;

    if (!isGenai || atMaxDepth) {
      const step = appendLeafStep(isGenai, args);
      spans.push(step.span);
      used += step.used;
      continue;
    }

    // Pick a pattern for this branch
    const pattern = Math.random();
    let step: StepResult;
    if (pattern < 0.35 && remaining >= 5) {
      step = appendAgentLoopStep(remaining, args);
    } else if (pattern < 0.55 && remaining >= 4) {
      step = appendRagPipelineStep(remaining, args);
    } else if (pattern < 0.7 && remaining >= 3) {
      step = appendWorkflowStep(remaining, args);
    } else {
      step = appendSingleLeafStep(isGenai, args);
    }
    spans.push(step.span);
    used += step.used;
  }

  return { spans, used };
}

/** Assign sequential offsets so the waterfall view looks realistic */
function assignOffsets(spans: SpanConfig[], startOffset: number = 0): void {
  let offset = startOffset;
  for (const span of spans) {
    span.offsetMs = offset;
    assignOffsets(span.children, 0);
    // Next sibling starts after a small gap
    offset += span.durationMs + randInt(1, 10);
  }
}

function countSpans(spans: SpanConfig[]): number {
  return spans.reduce((acc, s) => acc + 1 + countSpans(s.children), 0);
}

export function generateTrace(options: GeneratorOptions): TraceConfig {
  const { targetSpanCount, maxDepth, genaiRatio, prompts, includeEvents } = options;

  // Build the root span tree
  const rootAgent: SpanConfig = {
    id: shortId(),
    name: pick(AGENT_NAMES),
    type: "agent",
    durationMs: 0,
    offsetMs: 0,
    status: "ok",
    children: [],
    attributes: {},
    input: { type: "text", value: pick(USER_MESSAGES) },
    output: { type: "text", value: pick(ASSISTANT_RESPONSES) },
  };

  const { spans: children } = buildSubtree({
    budget: targetSpanCount - 1, // -1 for root
    depth: 1,
    maxDepth,
    genaiRatio,
    prompts,
    includeEvents,
  });

  rootAgent.children = children;
  rootAgent.durationMs = children.reduce((sum, c) => sum + c.durationMs, 0) + randInt(20, 100);

  assignOffsets([rootAgent]);

  const trace: TraceConfig = {
    id: shortId(),
    name: `Generated Trace (${countSpans([rootAgent])} spans)`,
    resourceAttributes: {
      "service.name": pick(["ai-agent", "chatbot-service", "ml-pipeline", "llm-gateway"]),
      "service.version": `${randInt(1, 5)}.${randInt(0, 20)}.${randInt(0, 99)}`,
    },
    metadata: {
      userId: `user-${randInt(1000, 9999)}`,
      threadId: `thread-${shortId()}`,
      customerId: `customer-${randInt(100, 999)}`,
      labels: [pick(["production", "staging", "development"]), pick(["v2", "beta", "canary"])],
    },
    spans: [rootAgent],
  };

  return trace;
}
