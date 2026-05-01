import type {
  SpanDetail,
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { ConversationTurn } from "../../hooks/useConversationContext";
import type {
  TraceEvalResult,
  TraceListEvent,
  TraceListItem,
} from "../../types/trace";

/**
 * Hand-crafted client-side sample traces. **These never round-trip
 * through OTel ingestion** — they live entirely in the browser as a
 * teaching surface for the empty state. The trace table renders them
 * just like any other rows so users can:
 *
 *   - feel out the layout, density modes, and column ordering
 *   - try filters, search, and facets against realistic content
 *   - hover/click to discover row affordances
 *
 * …all without committing real ingestion or a token. The moment the
 * project receives its first *real* trace (`project.firstMessage`
 * flips), this fixture stops being shown — see
 * `usePreviewTracesActive`.
 *
 * The shapes mirror what real Vercel AI SDK / Mastra / OpenAI Agents
 * SDK / LangChain integrations emit, so the user recognises the
 * pattern when they integrate. Span names, service names, model IDs,
 * and rough cost/latency profiles are drawn from real traces in dev,
 * with all customer content sanitised and replaced with realistic
 * fictional substitutes.
 *
 * Trace IDs are prefixed `lw-preview-` so any future drawer/data
 * lookup can short-circuit cleanly without hitting tRPC.
 */

const PREVIEW_PREFIX = "lw-preview-";

export function isPreviewTraceId(traceId: string): boolean {
  return traceId.startsWith(PREVIEW_PREFIX);
}

const NOW = () => Date.now();
const minutesAgo = (n: number) => NOW() - n * 60_000;

const noEvents: TraceListEvent[] = [];
const noEvals: TraceEvalResult[] = [];

interface MakeTraceArgs {
  id: string;
  ageMin: number;
  name: string;
  rootSpanType: string;
  serviceName: string;
  durationMs: number;
  models: string[];
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  spanCount: number;
  input: string;
  output: string | null;
  status?: TraceListItem["status"];
  error?: string;
  errorSpanName?: string;
  conversationId?: string;
  userId?: string;
  evaluations?: TraceEvalResult[];
}

function makeTrace(args: MakeTraceArgs): TraceListItem {
  return {
    traceId: `${PREVIEW_PREFIX}${args.id}`,
    timestamp: minutesAgo(args.ageMin),
    name: args.name,
    serviceName: args.serviceName,
    durationMs: args.durationMs,
    totalCost: args.totalCost,
    totalTokens: args.inputTokens + args.outputTokens,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    models: args.models,
    status: args.status ?? "ok",
    spanCount: args.spanCount,
    input: args.input,
    output: args.output,
    error: args.error,
    errorSpanName: args.errorSpanName,
    conversationId: args.conversationId,
    userId: args.userId,
    origin: "application",
    traceName: args.name,
    rootSpanType: args.rootSpanType,
    evaluations: args.evaluations ?? noEvals,
    events: noEvents,
  };
}

export const SAMPLE_PREVIEW_TRACES: readonly TraceListItem[] = [
  // 1. Mastra agent — billing refund w/ tool call (Anthropic)
  makeTrace({
    id: "01-mastra-billing-refund",
    ageMin: 1,
    name: "mastra.agent.run",
    rootSpanType: "agent",
    serviceName: "mastra-app",
    durationMs: 4820,
    models: ["claude-sonnet-4-5"],
    inputTokens: 612,
    outputTokens: 348,
    totalCost: 0.0184,
    spanCount: 6,
    input: "I was charged twice for my October subscription.",
    output:
      "I see two charges on your October plan — $19 on Oct 3 and $19 on Oct 4. The second one was a duplicate from a retried webhook. I've issued a refund of $19 to your card ending 4242; it should land in 3–5 business days.",
    conversationId: "conv-7821",
    userId: "user-31",
    evaluations: [
      {
        evaluatorId: "ragas-faithfulness",
        evaluatorName: "Faithfulness",
        status: "processed",
        score: 0.94,
        passed: true,
        label: null,
      },
    ],
  }),

  // 2. Vercel AI SDK — generateText, summarisation
  makeTrace({
    id: "02-vercel-ai-summary",
    ageMin: 2,
    name: "ai.generateText",
    rootSpanType: "agent",
    serviceName: "vercel-ai-app",
    durationMs: 1240,
    models: ["gpt-4o"],
    inputTokens: 412,
    outputTokens: 184,
    totalCost: 0.0042,
    spanCount: 3,
    input: "Summarise the attached customer feedback into 3 themes.",
    output:
      "1) Pricing clarity (12 mentions). 2) Mobile checkout friction (8). 3) Email frequency (5). Pricing clarity dominates — most asks are about plan limits and overage rules.",
    conversationId: "conv-7820",
    userId: "user-12",
    evaluations: [
      {
        evaluatorId: "lw-toxicity",
        evaluatorName: "Toxicity",
        status: "processed",
        score: 0.02,
        passed: true,
        label: null,
      },
    ],
  }),

  // 3. OpenAI Agents tool call (lookup_order)
  makeTrace({
    id: "03-openai-agents-lookup",
    ageMin: 2,
    name: "tool.lookup_order",
    rootSpanType: "tool",
    serviceName: "openai-agents-app",
    durationMs: 312,
    models: [],
    inputTokens: 0,
    outputTokens: 0,
    totalCost: 0,
    spanCount: 1,
    input: '{"order_id":"A-2104-77"}',
    output:
      '{"order_id":"A-2104-77","status":"shipped","carrier":"DHL","tracking":"1234567890"}',
    conversationId: "conv-7821",
  }),

  // 4. Vercel AI streamText, marketing copy
  makeTrace({
    id: "04-vercel-stream-marketing",
    ageMin: 3,
    name: "ai.streamText",
    rootSpanType: "llm",
    serviceName: "marketing-copywriter",
    durationMs: 832,
    models: ["gpt-4o"],
    inputTokens: 218,
    outputTokens: 96,
    totalCost: 0.0011,
    spanCount: 2,
    input: "Write a one-sentence subject line for a product launch email.",
    output: "Your traces just got a whole lot easier to read.",
    userId: "user-8",
  }),

  // 5. LangChain RAG chain over docs
  makeTrace({
    id: "05-langchain-rag-docs",
    ageMin: 4,
    name: "RunnableSequence",
    rootSpanType: "chain",
    serviceName: "docs-bot",
    durationMs: 2410,
    models: ["gpt-4o-mini"],
    inputTokens: 1284,
    outputTokens: 142,
    totalCost: 0.0009,
    spanCount: 5,
    input: "How do I rotate my API key without breaking production?",
    output:
      "Mint a new key from Settings → API Keys, deploy it alongside the old one, switch traffic over, then revoke the old key. Keys can overlap indefinitely — there's no forced rotation deadline.",
    conversationId: "conv-7822",
    userId: "user-44",
    evaluations: [
      {
        evaluatorId: "ragas-context-recall",
        evaluatorName: "Context recall",
        status: "processed",
        score: 0.88,
        passed: true,
        label: null,
      },
    ],
  }),

  // 6. Error: rate limit on Vercel AI generateText
  makeTrace({
    id: "06-error-rate-limit",
    ageMin: 5,
    name: "ai.generateText",
    rootSpanType: "llm",
    serviceName: "chatbot",
    durationMs: 142,
    models: ["gpt-4o"],
    inputTokens: 0,
    outputTokens: 0,
    totalCost: 0,
    spanCount: 1,
    input: "Draft a follow-up email for this thread.",
    output: null,
    status: "error",
    error: "Rate limit exceeded (429). Retry after 12s.",
    errorSpanName: "openai.chat.completions",
  }),

  // 7. Cheap Haiku classification
  makeTrace({
    id: "07-haiku-classify",
    ageMin: 6,
    name: "ai.generateText",
    rootSpanType: "llm",
    serviceName: "ticket-router",
    durationMs: 386,
    models: ["claude-haiku-4-5"],
    inputTokens: 124,
    outputTokens: 18,
    totalCost: 0.0001,
    spanCount: 1,
    input: 'Classify ticket #4421: "I can\'t log in after the update."',
    output: '{"category":"auth","priority":"p2","needs_human":false}',
  }),

  // 8. Long agent: research, multi-model, tool calls
  makeTrace({
    id: "08-agent-research-long",
    ageMin: 7,
    name: "agent.run",
    rootSpanType: "agent",
    serviceName: "openai-agents-app",
    durationMs: 18420,
    models: ["claude-sonnet-4-5", "gpt-4o"],
    inputTokens: 2840,
    outputTokens: 924,
    totalCost: 0.0612,
    spanCount: 14,
    input: "Find the top 3 competitor pricing pages and summarise plan tiers.",
    output:
      "Three competitors compared: Datadog (3 tiers, $15/host base), New Relic (4 tiers, free → custom), and Honeycomb (3 tiers, event-based). Detailed table attached.",
    userId: "user-3",
    evaluations: [
      {
        evaluatorId: "lw-relevance",
        evaluatorName: "Answer relevance",
        status: "processed",
        score: 0.91,
        passed: true,
        label: null,
      },
    ],
  }),

  // 9. Mastra tool execution — github_trending pattern
  makeTrace({
    id: "09-mastra-tool-trending",
    ageMin: 8,
    name: "mastra.tool.execute github_trending",
    rootSpanType: "tool",
    serviceName: "mastra-app",
    durationMs: 1218,
    models: [],
    inputTokens: 0,
    outputTokens: 0,
    totalCost: 0,
    spanCount: 1,
    input: '{"language":"typescript","since":"weekly"}',
    output:
      '[{"repo":"vercel/ai","stars":12480,"delta":"+412"},{"repo":"mastra-ai/mastra","stars":8112,"delta":"+289"},{"repo":"langchain-ai/langchainjs","stars":15234,"delta":"+187"}]',
  }),

  // 10. Warning: truncated due to max output tokens
  makeTrace({
    id: "10-warning-truncated",
    ageMin: 9,
    name: "ai.generateText",
    rootSpanType: "llm",
    serviceName: "legal-review",
    durationMs: 6210,
    models: ["gpt-4o"],
    inputTokens: 7842,
    outputTokens: 1024,
    totalCost: 0.0312,
    spanCount: 4,
    input: "Continue the legal review on the attached 60-page contract…",
    output:
      "Reviewed sections 1–42. Hit max output tokens before sections 43–60 — please re-issue with continuation_token=tok-9482.",
    status: "warning",
    userId: "user-3",
  }),

  // 11. Mistral translation pipeline
  makeTrace({
    id: "11-mistral-translation",
    ageMin: 11,
    name: "ai.generateText",
    rootSpanType: "llm",
    serviceName: "i18n-pipeline",
    durationMs: 612,
    models: ["mistral-large"],
    inputTokens: 384,
    outputTokens: 412,
    totalCost: 0.0018,
    spanCount: 2,
    input: "Translate the onboarding emails into French and German.",
    output:
      "FR: Bienvenue chez LangWatch — votre première trace n'est qu'à un appel d'API. \nDE: Willkommen bei LangWatch — Ihr erster Trace ist nur einen API-Aufruf entfernt.",
  }),

  // 12. Mastra agent — second billing turn
  makeTrace({
    id: "12-mastra-cancel-sub",
    ageMin: 14,
    name: "mastra.agent.generate",
    rootSpanType: "agent",
    serviceName: "mastra-app",
    durationMs: 3120,
    models: ["claude-sonnet-4-5"],
    inputTokens: 488,
    outputTokens: 218,
    totalCost: 0.0118,
    spanCount: 5,
    input: "Cancel my subscription effective end of month.",
    output:
      "Confirmed — your Pro plan will cancel on Nov 30. You'll keep access until then. Want me to schedule a quick exit feedback call?",
    conversationId: "conv-7823",
    userId: "user-7",
  }),

  // 13. Faithfulness eval failed — hallucinated Java SDK claim
  makeTrace({
    id: "13-eval-faithfulness-fail",
    ageMin: 18,
    name: "RunnableSequence",
    rootSpanType: "chain",
    serviceName: "docs-bot",
    durationMs: 942,
    models: ["gpt-4o-mini"],
    inputTokens: 612,
    outputTokens: 220,
    totalCost: 0.0008,
    spanCount: 4,
    input: "Does LangWatch support OpenTelemetry traces from Java?",
    output:
      "Yes — LangWatch ships an official Java OTLP exporter with out-of-the-box GenAI semantic convention mapping.",
    evaluations: [
      {
        evaluatorId: "ragas-faithfulness",
        evaluatorName: "Faithfulness",
        status: "processed",
        score: 0.41,
        passed: false,
        label: null,
      },
    ],
  }),

  // 14. OpenAI Agents — process_refund tool
  makeTrace({
    id: "14-tool-process-refund",
    ageMin: 22,
    name: "tool.process_refund",
    rootSpanType: "tool",
    serviceName: "openai-agents-app",
    durationMs: 812,
    models: [],
    inputTokens: 0,
    outputTokens: 0,
    totalCost: 0,
    spanCount: 1,
    input: '{"order_id":"A-2104-77","amount":1900,"reason":"duplicate_charge"}',
    output:
      '{"refund_id":"re_1Pjk7H","status":"succeeded","amount":1900,"currency":"usd","arrival":"2025-11-04"}',
  }),

  // 15. Tiny GPT-4o-mini hello
  makeTrace({
    id: "15-cheap-hello",
    ageMin: 28,
    name: "ai.generateText",
    rootSpanType: "llm",
    serviceName: "chatbot",
    durationMs: 412,
    models: ["gpt-4o-mini"],
    inputTokens: 96,
    outputTokens: 32,
    totalCost: 0.0001,
    spanCount: 1,
    input: "Say hello in five languages.",
    output: "Hello, Hola, Bonjour, Hallo, こんにちは.",
  }),

  // 16. Multi-model orchestrator agent (Gemini Flash + GPT-4o-mini)
  makeTrace({
    id: "16-orchestrator-multimodel",
    ageMin: 32,
    name: "orchestrator",
    rootSpanType: "agent",
    serviceName: "ml-pipeline",
    durationMs: 6233,
    models: ["gemini-2.5-flash", "gpt-4o-mini"],
    inputTokens: 1840,
    outputTokens: 312,
    totalCost: 0.00099,
    spanCount: 10,
    input: "What's the current status of ticket PROJ-1234?",
    output:
      "PROJ-1234 is in code review, assigned to user-44, blocked on a flaky CI step. Last update 2h ago — they're rerunning the integration suite now.",
    conversationId: "conv-7824",
    userId: "user-19",
  }),

  // 17. Vercel AI SDK with toolCall children — analytics question
  makeTrace({
    id: "17-vercel-tools-analytics",
    ageMin: 38,
    name: "ai.generateText",
    rootSpanType: "agent",
    serviceName: "vercel-ai-app",
    durationMs: 1611,
    models: ["gpt-4o-mini"],
    inputTokens: 731,
    outputTokens: 95,
    totalCost: 0.000167,
    spanCount: 4,
    input: "How many users signed up last month who are still active?",
    output:
      "There were 1,247 signups in March and 891 (71.5%) are still active. Activation cohort week-over-week: 78% / 74% / 71% / 69%.",
    userId: "user-3",
  }),

  // 18. Sonnet research summary, agent root
  makeTrace({
    id: "18-sonnet-research-summary",
    ageMin: 44,
    name: "ai.generateText",
    rootSpanType: "agent",
    serviceName: "vercel-ai-app",
    durationMs: 884,
    models: ["claude-sonnet-4-5"],
    inputTokens: 612,
    outputTokens: 208,
    totalCost: 0.004956,
    spanCount: 3,
    input:
      "Summarise the key findings on transformer scaling laws from the recent papers.",
    output:
      "Three converging findings: (1) compute-optimal training favours smaller models on more tokens (Hoffmann et al.), (2) instruction-tuning quality matters more than quantity past a threshold, (3) sparse attention reduces inference cost ~40% with negligible quality loss.",
    userId: "user-19",
  }),

  // 19. Workflow: multi-prompt pipeline (e.g. extract → enrich → format)
  makeTrace({
    id: "19-workflow-multi-prompt",
    ageMin: 56,
    name: "multi-prompt-pipeline",
    rootSpanType: "workflow",
    serviceName: "extraction-service",
    durationMs: 4012,
    models: ["gpt-4o", "gpt-4o-mini"],
    inputTokens: 1432,
    outputTokens: 488,
    totalCost: 0.000787,
    spanCount: 8,
    input:
      "Extract the company name, role, and salary band from this job description and format as JSON.",
    output:
      '{"company":"Acme Robotics","role":"Senior ML Engineer","salary_band":{"min":175000,"max":225000,"currency":"USD"},"remote":true,"location":"Remote (US)"}',
    userId: "user-12",
    evaluations: [
      {
        evaluatorId: "lw-json-validity",
        evaluatorName: "JSON validity",
        status: "processed",
        score: 1,
        passed: true,
        label: null,
      },
    ],
  }),

  // 20. Long Mastra agent run with many tool calls
  makeTrace({
    id: "20-mastra-deep-research",
    ageMin: 71,
    name: "mastra.agent.run",
    rootSpanType: "agent",
    serviceName: "mastra-app",
    durationMs: 22340,
    models: ["claude-sonnet-4-5", "gemini-2.5-pro"],
    inputTokens: 4128,
    outputTokens: 1612,
    totalCost: 0.0418,
    spanCount: 18,
    input:
      "Research the migration story from Cloud Run to Fly.io for our shape of workload (long-running websockets, ~50 RPS).",
    output:
      "Fly.io is a better fit on three axes: (1) websockets are first-class with sticky sessions per region, (2) per-machine pricing rounds in your favour at 50 RPS, (3) global anycast cuts p95 by ~30ms vs Cloud Run's regional model. Caveats: cold-start on scale-to-zero is rougher, and IAM is less mature.",
    userId: "user-7",
    evaluations: [
      {
        evaluatorId: "lw-relevance",
        evaluatorName: "Answer relevance",
        status: "processed",
        score: 0.86,
        passed: true,
        label: null,
      },
    ],
  }),

  // 21. Error: provider connection failure
  makeTrace({
    id: "21-error-connect-fail",
    ageMin: 88,
    name: "ai.generateText",
    rootSpanType: "agent",
    serviceName: "vercel-ai-app",
    durationMs: 6094,
    models: ["gpt-4o"],
    inputTokens: 0,
    outputTokens: 0,
    totalCost: 0,
    spanCount: 6,
    input: "Draft a release-note paragraph for the v3.4 rollout.",
    output: null,
    status: "error",
    error: "Failed after 3 attempts. Cannot connect to API: ECONNRESET",
    errorSpanName: "openai.responses.create",
    userId: "user-44",
  }),

  // 22. Gemini Flash for classification — cheap and fast
  makeTrace({
    id: "22-gemini-flash-classify",
    ageMin: 102,
    name: "ai.generateText",
    rootSpanType: "llm",
    serviceName: "moderation-service",
    durationMs: 489,
    models: ["gemini-2.5-flash"],
    inputTokens: 318,
    outputTokens: 28,
    totalCost: 0.000082,
    spanCount: 1,
    input: "Classify this support message for sentiment and urgency.",
    output:
      '{"sentiment":"frustrated","urgency":"high","themes":["billing","churn_risk"]}',
    conversationId: "conv-7830",
    userId: "user-22",
  }),

  // 23. LangChain conversation chain with retrieval
  makeTrace({
    id: "23-langchain-conversation",
    ageMin: 134,
    name: "ConversationalRetrievalChain",
    rootSpanType: "chain",
    serviceName: "support-bot",
    durationMs: 2014,
    models: ["gpt-4o-mini"],
    inputTokens: 1840,
    outputTokens: 248,
    totalCost: 0.000478,
    spanCount: 7,
    input:
      "Following up on my last question — does the API key rotation also rotate webhook signing secrets?",
    output:
      "No, those are separate. Webhook signing secrets live under Settings → Webhooks and rotate independently. You can mint a new signing secret and keep both active during rollout.",
    conversationId: "conv-7822",
    userId: "user-44",
  }),

  // 24. OpenAI Agents — multi-step refund workflow
  makeTrace({
    id: "24-openai-agents-refund-flow",
    ageMin: 178,
    name: "agent.run",
    rootSpanType: "agent",
    serviceName: "openai-agents-app",
    durationMs: 5421,
    models: ["gpt-4o"],
    inputTokens: 1212,
    outputTokens: 412,
    totalCost: 0.0089,
    spanCount: 9,
    input: "I returned my hardware kit on Oct 28 and haven't seen the refund.",
    output:
      "Confirmed — your return arrived at the warehouse on Oct 30 and the refund of $148.00 was issued today to the card ending 0319. Stripe shows it should land by Nov 5.",
    conversationId: "conv-7831",
    userId: "user-58",
    evaluations: [
      {
        evaluatorId: "lw-toxicity",
        evaluatorName: "Toxicity",
        status: "processed",
        score: 0.01,
        passed: true,
        label: null,
      },
      {
        evaluatorId: "lw-relevance",
        evaluatorName: "Answer relevance",
        status: "processed",
        score: 0.93,
        passed: true,
        label: null,
      },
    ],
  }),

  // 25. Code generation, expensive turn
  makeTrace({
    id: "25-codegen-typescript",
    ageMin: 215,
    name: "ai.generateText",
    rootSpanType: "llm",
    serviceName: "ide-assistant",
    durationMs: 1742,
    models: ["gpt-4o"],
    inputTokens: 7575,
    outputTokens: 461,
    totalCost: 0.020548,
    spanCount: 2,
    input:
      "Add a debounced version of useSearchQuery that respects the cancel signal.",
    output:
      "Wrapped the existing hook in a 250ms debounce using a stable AbortController. New behaviour: keystrokes within the debounce window cancel the in-flight request before issuing the next one. Tests added in useSearchQuery.test.ts.",
    userId: "user-19",
  }),
];

/**
 * Two fixtures held back from the initial render and inserted at
 * the top of the table when the empty-state journey advances to the
 * Aurora arrival stage. The first is rich (long agent run, multiple
 * models, attached eval) — that's the one the post-arrival hero
 * copy points at as "the juicy one." The second is a short
 * companion so the moment reads as "two new traces just arrived,"
 * not "one." Both have very low `ageMin` so they sort to the top of
 * the table the moment they appear.
 */
export const ARRIVAL_PREVIEW_TRACES: readonly TraceListItem[] = [
  // The rich one — directed click target after arrival.
  makeTrace({
    id: "arrival-01-mastra-deep-eval",
    ageMin: 0.3,
    name: "mastra.agent.run",
    rootSpanType: "agent",
    serviceName: "mastra-app",
    durationMs: 18420,
    models: ["claude-sonnet-4-5", "gpt-4o"],
    inputTokens: 3128,
    outputTokens: 924,
    totalCost: 0.0512,
    spanCount: 18,
    input: "Checkout conversion dropped ~18% yesterday morning. What happened?",
    output:
      "Two changes converged at 09:14 UTC. Checkout v2 hit 100% rollout — v2 has an open issue with PayPal redirects on iOS Safari (≈12pp of the drop). The abandonment-recovery email job was paused at 08:30 UTC for a migration and never re-enabled (≈6pp). Re-enable the job and pin v2 off iOS Safari until #4421 lands.",
    conversationId: "conv-9001",
    userId: "user-3",
    evaluations: [
      {
        evaluatorId: "lw-relevance",
        evaluatorName: "Answer relevance",
        status: "processed",
        score: 0.93,
        passed: true,
        label: null,
      },
      {
        evaluatorId: "ragas-faithfulness",
        evaluatorName: "Faithfulness",
        status: "processed",
        score: 0.89,
        passed: true,
        label: null,
      },
    ],
  }),
  // Short companion — reinforces "two new" without competing for
  // attention. Cheap, fast, single-span.
  makeTrace({
    id: "arrival-02-streamtext-quick",
    ageMin: 0.6,
    name: "ai.streamText",
    rootSpanType: "llm",
    serviceName: "vercel-ai-app",
    durationMs: 412,
    models: ["gpt-4o-mini"],
    inputTokens: 142,
    outputTokens: 38,
    totalCost: 0.0001,
    spanCount: 1,
    input: "Reword this in active voice: 'Improvements were made to the API.'",
    output: "We improved the API.",
    userId: "user-12",
  }),
];

/** The rich trace — the one the post-arrival hero points at. */
export const RICH_ARRIVAL_TRACE_ID = ARRIVAL_PREVIEW_TRACES[0]!.traceId;

// ---------------------------------------------------------------------------
// Rich drawer detail for the arrival trace.
//
// When the user clicks the "juicy one" in the empty-state table, the drawer
// opens against a synthetic trace ID that has nothing in ClickHouse. To make
// every tab render with believable content (waterfall, span list, sequence,
// topology, conversation, evaluations) we hand-build the detail payloads
// here and seed them into the tRPC cache via `useOpenTraceDrawer`.
//
// Shapes mirror the real router outputs: `TraceHeader`, `SpanTreeNode[]`,
// `SpanDetail[]`, `EvaluationRunData[]`, and the `conversationContext`
// procedure return value. Anything customer-specific is sanitised — IDs,
// model names, tool names, and prompts are realistic but generic, and the
// I/O text is reframed around the "checkout conversion dropped 18%" theme
// so the drawer reads consistently with the row that opened it — every
// tool fetch and LLM call narrates the same operational debug story.
// ---------------------------------------------------------------------------

const richArrival = ARRIVAL_PREVIEW_TRACES[0]!;

/** Stable epoch base so all derived span timestamps line up cleanly. */
const RICH_ARRIVAL_BASE_TS = richArrival.timestamp;
const richTs = (offsetMs: number) => RICH_ARRIVAL_BASE_TS + offsetMs;

/**
 * Span tree for the rich preview trace. The shape mirrors a Mastra agent
 * run: a root `mastra.agent.run`, a parallel research stage that fans out
 * into two LLM calls plus a couple of tool calls, then a writer stage with
 * a synthesis LLM call and a final formatter pass.
 *
 * Span types pull from the LangWatch span-type taxonomy (`agent`, `chain`,
 * `llm`, `tool`) so the waterfall, flame, span list, sequence, and
 * topology views all colour-code naturally.
 */
const RICH_ARRIVAL_SPAN_TREE: SpanTreeNode[] = [
  {
    spanId: "span-root-agent",
    parentSpanId: null,
    name: "mastra.agent.run",
    type: "agent",
    startTimeMs: richTs(0),
    endTimeMs: richTs(18420),
    durationMs: 18420,
    status: "ok",
    model: null,
  },
  {
    spanId: "span-router",
    parentSpanId: "span-root-agent",
    name: "router.classify",
    type: "chain",
    startTimeMs: richTs(20),
    endTimeMs: richTs(412),
    durationMs: 392,
    status: "ok",
    model: null,
  },
  {
    spanId: "span-router-llm",
    parentSpanId: "span-router",
    name: "chat gpt-4o",
    type: "llm",
    startTimeMs: richTs(40),
    endTimeMs: richTs(390),
    durationMs: 350,
    status: "ok",
    model: "gpt-4o",
  },
  {
    spanId: "span-research-stage",
    parentSpanId: "span-root-agent",
    name: "research.parallel",
    type: "chain",
    startTimeMs: richTs(420),
    endTimeMs: richTs(9120),
    durationMs: 8700,
    status: "ok",
    model: null,
  },
  {
    spanId: "span-tool-discography",
    parentSpanId: "span-research-stage",
    name: "tool.fetch_funnel_metrics",
    type: "tool",
    startTimeMs: richTs(440),
    endTimeMs: richTs(1290),
    durationMs: 850,
    status: "ok",
    model: null,
  },
  {
    spanId: "span-tool-bridge-corpus",
    parentSpanId: "span-research-stage",
    name: "tool.fetch_deploy_log",
    type: "tool",
    startTimeMs: richTs(440),
    endTimeMs: richTs(1820),
    durationMs: 1380,
    status: "ok",
    model: null,
  },
  {
    spanId: "span-llm-summarise-folklore",
    parentSpanId: "span-research-stage",
    name: "chat claude-sonnet-4-5",
    type: "llm",
    startTimeMs: richTs(1860),
    endTimeMs: richTs(6240),
    durationMs: 4380,
    status: "ok",
    model: "claude-sonnet-4-5",
  },
  {
    spanId: "span-llm-summarise-evermore",
    parentSpanId: "span-research-stage",
    name: "chat gpt-4o",
    type: "llm",
    startTimeMs: richTs(1860),
    endTimeMs: richTs(5610),
    durationMs: 3750,
    status: "ok",
    model: "gpt-4o",
  },
  {
    spanId: "span-llm-rerank",
    parentSpanId: "span-research-stage",
    name: "chat gpt-4o",
    type: "llm",
    startTimeMs: richTs(6260),
    endTimeMs: richTs(9100),
    durationMs: 2840,
    status: "ok",
    model: "gpt-4o",
  },
  {
    spanId: "span-writer",
    parentSpanId: "span-root-agent",
    name: "writer.compose",
    type: "chain",
    startTimeMs: richTs(9140),
    endTimeMs: richTs(17120),
    durationMs: 7980,
    status: "ok",
    model: null,
  },
  {
    spanId: "span-llm-defense",
    parentSpanId: "span-writer",
    name: "chat claude-sonnet-4-5",
    type: "llm",
    startTimeMs: richTs(9160),
    endTimeMs: richTs(15880),
    durationMs: 6720,
    status: "ok",
    model: "claude-sonnet-4-5",
  },
  {
    spanId: "span-tool-citation",
    parentSpanId: "span-writer",
    name: "tool.attach_citations",
    type: "tool",
    startTimeMs: richTs(15900),
    endTimeMs: richTs(16480),
    durationMs: 580,
    status: "ok",
    model: null,
  },
  {
    spanId: "span-llm-format",
    parentSpanId: "span-writer",
    name: "chat gpt-4o",
    type: "llm",
    startTimeMs: richTs(16500),
    endTimeMs: richTs(17110),
    durationMs: 610,
    status: "ok",
    model: "gpt-4o",
  },
  {
    spanId: "span-guardrail",
    parentSpanId: "span-root-agent",
    name: "guardrail.toxicity",
    type: "chain",
    startTimeMs: richTs(17140),
    endTimeMs: richTs(17420),
    durationMs: 280,
    status: "ok",
    model: null,
  },
  {
    spanId: "span-publish",
    parentSpanId: "span-root-agent",
    name: "tool.publish_response",
    type: "tool",
    startTimeMs: richTs(17440),
    endTimeMs: richTs(17890),
    durationMs: 450,
    status: "ok",
    model: null,
  },
  {
    spanId: "span-eval-relevance",
    parentSpanId: "span-root-agent",
    name: "evaluator.answer_relevance",
    type: "chain",
    startTimeMs: richTs(17910),
    endTimeMs: richTs(18180),
    durationMs: 270,
    status: "ok",
    model: null,
  },
  {
    spanId: "span-eval-faithfulness",
    parentSpanId: "span-root-agent",
    name: "evaluator.faithfulness",
    type: "chain",
    startTimeMs: richTs(18190),
    endTimeMs: richTs(18400),
    durationMs: 210,
    status: "ok",
    model: null,
  },
  {
    spanId: "span-metrics",
    parentSpanId: "span-root-agent",
    name: "metrics.record",
    type: "tool",
    startTimeMs: richTs(18405),
    endTimeMs: richTs(18420),
    durationMs: 15,
    status: "ok",
    model: null,
  },
];

/**
 * Full span detail (with input/output payloads, params, and per-LLM token
 * usage) for the LLM panel + per-span accordion. Keys mirror what the real
 * `tracesV2.spanDetail` and `tracesV2.spansFull` procedures return.
 */
const RICH_ARRIVAL_SPAN_DETAILS: SpanDetail[] = [
  {
    spanId: "span-root-agent",
    parentSpanId: null,
    name: "mastra.agent.run",
    type: "agent",
    startTimeMs: richTs(0),
    endTimeMs: richTs(18420),
    durationMs: 18420,
    status: "ok",
    model: null,
    vendor: null,
    input: richArrival.input,
    output: richArrival.output,
    error: null,
    metrics: {
      promptTokens: richArrival.inputTokens ?? 0,
      completionTokens: richArrival.outputTokens ?? 0,
      cost: richArrival.totalCost,
      tokensEstimated: false,
    },
    params: {
      "langwatch.span.type": "agent",
      "service.name": "mastra-app",
      "gen_ai.conversation.id": "conv-9001",
    },
    events: [],
  },
  {
    spanId: "span-router-llm",
    parentSpanId: "span-router",
    name: "chat gpt-4o",
    type: "llm",
    startTimeMs: richTs(40),
    endTimeMs: richTs(390),
    durationMs: 350,
    status: "ok",
    model: "gpt-4o",
    vendor: "openai",
    input: JSON.stringify(
      {
        type: "chat_messages",
        value: [
          {
            role: "system",
            content:
              "You route incoming product analytics questions to the right specialist agent. Reply with one of: funnel_drop, latency_regression, error_spike, cohort_shift.",
          },
          {
            role: "user",
            content:
              "Why did checkout conversion drop ~18% last Thursday? Walk me through what happened.",
          },
        ],
      },
      null,
      2,
    ),
    output: '{"route":"funnel_drop","confidence":0.96}',
    error: null,
    metrics: {
      promptTokens: 142,
      completionTokens: 18,
      cost: 0.000412,
      tokensEstimated: false,
    },
    params: {
      "gen_ai.request.temperature": 0,
      "gen_ai.request.top_p": 1,
    },
    events: [],
  },
  {
    spanId: "span-tool-discography",
    parentSpanId: "span-research-stage",
    name: "tool.fetch_funnel_metrics",
    type: "tool",
    startTimeMs: richTs(440),
    endTimeMs: richTs(1290),
    durationMs: 850,
    status: "ok",
    model: null,
    vendor: null,
    input:
      '{"funnel":"checkout","window":"prev_24h","granularity":"hour","groupBy":["browser","platform"]}',
    output:
      '{"baseline_conversion":0.412,"yesterday_conversion":0.337,"delta":-0.075,"breakdown":{"safari_ios":-0.121,"chrome_desktop":-0.018,"firefox":-0.006,"chrome_android":-0.011}}',
    error: null,
    metrics: null,
    params: { "tool.kind": "http" },
    events: [],
  },
  {
    spanId: "span-tool-bridge-corpus",
    parentSpanId: "span-research-stage",
    name: "tool.fetch_deploy_log",
    type: "tool",
    startTimeMs: richTs(440),
    endTimeMs: richTs(1820),
    durationMs: 1380,
    status: "ok",
    model: null,
    vendor: null,
    input:
      '{"window":"prev_24h","services":["checkout","payments","email-jobs"]}',
    output:
      '{"events":[{"ts":"08:30Z","service":"email-jobs","action":"paused","reason":"db migration","author":"alex"},{"ts":"09:14Z","service":"checkout","action":"rollout_100","version":"v2.4.0","notes":"open issue #4421 — paypal redirect ios safari"},{"ts":"11:02Z","service":"payments","action":"config_change","field":"3ds_threshold","from":"50","to":"75"}]}',
    error: null,
    metrics: null,
    params: { "tool.kind": "http", "rag.index": "deploy-log-v2" },
    events: [],
  },
  {
    spanId: "span-llm-summarise-folklore",
    parentSpanId: "span-research-stage",
    name: "chat claude-sonnet-4-5",
    type: "llm",
    startTimeMs: richTs(1860),
    endTimeMs: richTs(6240),
    durationMs: 4380,
    status: "ok",
    model: "claude-sonnet-4-5",
    vendor: "anthropic",
    input: JSON.stringify(
      {
        type: "chat_messages",
        value: [
          {
            role: "system",
            content:
              "Look at the funnel metrics breakdown by browser. Identify which segment regressed hardest and quantify the impact.",
          },
          {
            role: "user",
            content:
              "Use the funnel metrics snapshot. Be specific about the segment and the size of the drop.",
          },
        ],
      },
      null,
      2,
    ),
    output:
      "Safari iOS regressed -12.1pp vs baseline (0.412 → 0.291), accounting for ≈12pp of the overall 7.5pp blended drop on its own — that segment is the dominant contributor. Other browsers drifted within noise (-0.6 to -1.8pp).",
    error: null,
    metrics: {
      promptTokens: 612,
      completionTokens: 184,
      cost: 0.0124,
      tokensEstimated: false,
    },
    params: {
      "gen_ai.request.temperature": 0.2,
      "gen_ai.request.max_tokens": 512,
    },
    events: [],
  },
  {
    spanId: "span-llm-summarise-evermore",
    parentSpanId: "span-research-stage",
    name: "chat gpt-4o",
    type: "llm",
    startTimeMs: richTs(1860),
    endTimeMs: richTs(5610),
    durationMs: 3750,
    status: "ok",
    model: "gpt-4o",
    vendor: "openai",
    input: JSON.stringify(
      {
        type: "chat_messages",
        value: [
          {
            role: "system",
            content:
              "Look at the deploy log. Identify any events in the affected window that could plausibly have caused the regression.",
          },
          {
            role: "user",
            content:
              "Three deploy events fired between 08:30 and 11:02. Which ones touch the impacted segment, and how confident are you?",
          },
        ],
      },
      null,
      2,
    ),
    output:
      "Two candidates: (1) checkout v2 rollout at 09:14Z carries an open issue #4421 for PayPal redirects on iOS Safari — high confidence, the timing and segment match. (2) email-jobs paused at 08:30Z removes abandonment-recovery sends, which historically lift recovered conversion by ~6pp — high confidence, blended-only impact. The 3ds_threshold config change at 11:02Z post-dates the drop, low confidence.",
    error: null,
    metrics: {
      promptTokens: 588,
      completionTokens: 162,
      cost: 0.0042,
      tokensEstimated: false,
    },
    params: {
      "gen_ai.request.temperature": 0.2,
      "gen_ai.request.max_tokens": 512,
    },
    events: [],
  },
  {
    spanId: "span-llm-rerank",
    parentSpanId: "span-research-stage",
    name: "chat gpt-4o",
    type: "llm",
    startTimeMs: richTs(6260),
    endTimeMs: richTs(9100),
    durationMs: 2840,
    status: "ok",
    model: "gpt-4o",
    vendor: "openai",
    input: JSON.stringify(
      {
        type: "chat_messages",
        value: [
          {
            role: "system",
            content:
              "Rank candidate causes by attributable impact (pp of conversion drop) and confidence. Score 0-1 each, output ordered list.",
          },
          {
            role: "user",
            content:
              "Candidates: checkout-v2 rollout, email-jobs pause, 3ds_threshold config change. Funnel breakdown + deploy log are in context.",
          },
        ],
      },
      null,
      2,
    ),
    output:
      '[{"cause":"checkout-v2 rollout","attributable_pp":12.0,"confidence":0.92,"rationale":"timing + segment match #4421"},{"cause":"email-jobs paused","attributable_pp":6.0,"confidence":0.84,"rationale":"recovery lift removed at 08:30Z"},{"cause":"3ds_threshold change","attributable_pp":0.5,"confidence":0.18,"rationale":"post-dates the drop"}]',
    error: null,
    metrics: {
      promptTokens: 412,
      completionTokens: 142,
      cost: 0.0028,
      tokensEstimated: false,
    },
    params: {
      "gen_ai.request.temperature": 0,
      "langwatch.rerank.model": "gpt-4o",
    },
    events: [],
  },
  {
    spanId: "span-llm-defense",
    parentSpanId: "span-writer",
    name: "chat claude-sonnet-4-5",
    type: "llm",
    startTimeMs: richTs(9160),
    endTimeMs: richTs(15880),
    durationMs: 6720,
    status: "ok",
    model: "claude-sonnet-4-5",
    vendor: "anthropic",
    input: JSON.stringify(
      {
        type: "chat_messages",
        value: [
          {
            role: "system",
            content:
              "Write a tight explanation of the regression. Name the two contributing causes, attribute impact in pp, and recommend the immediate fix. No hedging.",
          },
          {
            role: "user",
            content:
              "Top causes: checkout-v2 rollout (12pp), email-jobs pause (6pp). Cite the deploy log timestamps.",
          },
        ],
      },
      null,
      2,
    ),
    output:
      "Two changes converged at 09:14 UTC. Checkout v2 hit 100% rollout — v2 has an open issue with PayPal redirects on iOS Safari (≈12pp of the drop). The abandonment-recovery email job was paused at 08:30 UTC for a migration and never re-enabled (≈6pp). Re-enable the job and pin v2 off iOS Safari until #4421 lands.",
    error: null,
    metrics: {
      promptTokens: 980,
      completionTokens: 310,
      cost: 0.022,
      tokensEstimated: false,
    },
    params: {
      "gen_ai.request.temperature": 0.4,
      "gen_ai.request.max_tokens": 256,
    },
    events: [],
  },
  {
    spanId: "span-tool-citation",
    parentSpanId: "span-writer",
    name: "tool.attach_citations",
    type: "tool",
    startTimeMs: richTs(15900),
    endTimeMs: richTs(16480),
    durationMs: 580,
    status: "ok",
    model: null,
    vendor: null,
    input:
      '{"claims":[{"text":"checkout v2 100% rollout at 09:14Z","source":"deploy-log"},{"text":"email-jobs paused at 08:30Z","source":"deploy-log"}]}',
    output:
      '{"citations":[{"sourceId":"deploy-log","ts":"09:14Z","ref":"#4421","confidence":0.95},{"sourceId":"deploy-log","ts":"08:30Z","ref":"email-jobs#paused","confidence":0.92}]}',
    error: null,
    metrics: null,
    params: { "tool.kind": "rag-citation" },
    events: [],
  },
  {
    spanId: "span-llm-format",
    parentSpanId: "span-writer",
    name: "chat gpt-4o",
    type: "llm",
    startTimeMs: richTs(16500),
    endTimeMs: richTs(17110),
    durationMs: 610,
    status: "ok",
    model: "gpt-4o",
    vendor: "openai",
    input: JSON.stringify(
      {
        type: "chat_messages",
        value: [
          {
            role: "system",
            content:
              "Format the answer for the chat UI. Trim hedging. Keep the timestamps + the recommended fix.",
          },
        ],
      },
      null,
      2,
    ),
    output: richArrival.output,
    error: null,
    metrics: {
      promptTokens: 394,
      completionTokens: 108,
      cost: 0.0024,
      tokensEstimated: false,
    },
    params: { "gen_ai.request.temperature": 0 },
    events: [],
  },
  {
    spanId: "span-publish",
    parentSpanId: "span-root-agent",
    name: "tool.publish_response",
    type: "tool",
    startTimeMs: richTs(17440),
    endTimeMs: richTs(17890),
    durationMs: 450,
    status: "ok",
    model: null,
    vendor: null,
    input: '{"channel":"chat","conversationId":"conv-9001"}',
    output: '{"messageId":"msg-91-arrival","delivered":true}',
    error: null,
    metrics: null,
    params: { "tool.kind": "http", "http.method": "POST" },
    events: [],
  },
];

/**
 * Trace header for the rich preview trace. Built from the existing list-row
 * fixture plus a couple of attributes the drawer chrome reads (service
 * name, conversation id, root span name) so chips render correctly.
 */
function buildRichArrivalHeader(): TraceHeader {
  return {
    traceId: richArrival.traceId,
    timestamp: richArrival.timestamp,
    name: richArrival.name,
    serviceName: richArrival.serviceName,
    origin: richArrival.origin,
    conversationId: richArrival.conversationId ?? null,
    userId: richArrival.userId ?? null,
    durationMs: richArrival.durationMs,
    spanCount: RICH_ARRIVAL_SPAN_TREE.length,
    status: richArrival.status,
    error: richArrival.error ?? null,
    input: richArrival.input,
    output: richArrival.output,
    models: richArrival.models,
    totalCost: richArrival.totalCost,
    totalTokens: richArrival.totalTokens,
    inputTokens: richArrival.inputTokens ?? null,
    outputTokens: richArrival.outputTokens ?? null,
    tokensEstimated: false,
    ttft: 412,
    traceName: richArrival.name,
    rootSpanType: richArrival.rootSpanType ?? "agent",
    scenarioRunId: null,
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    attributes: {
      "langwatch.span.name": richArrival.name,
      "service.name": richArrival.serviceName,
      "langwatch.origin": richArrival.origin,
      "gen_ai.conversation.id": richArrival.conversationId ?? "",
      "langwatch.user_id": richArrival.userId ?? "",
    },
    events: [],
  };
}

/**
 * Conversation context for the rich preview trace — three sibling turns
 * (a check-in before, the active funnel question, the follow-up fix).
 * The shape matches the `tracesV2.conversationContext` procedure return.
 */
interface RichArrivalConversationContext {
  conversationId: string;
  total: number;
  turns: ConversationTurn[];
}

function buildRichArrivalConversationContext(): RichArrivalConversationContext {
  const conversationId = richArrival.conversationId ?? "conv-9001";
  return {
    conversationId,
    total: 3,
    turns: [
      {
        traceId: "lw-preview-arrival-conv-prev",
        timestamp: richArrival.timestamp - 4 * 60_000,
        name: "mastra.agent.run",
        rootSpanType: "agent",
        status: "ok",
        input: "How's the checkout funnel looking today?",
        output:
          "Conversion is sitting at 33.7% over the last 24h, materially below the 41.2% baseline. The drop concentrates in this morning's window. Want me to dig in?",
      },
      {
        traceId: richArrival.traceId,
        timestamp: richArrival.timestamp,
        name: richArrival.name,
        rootSpanType: richArrival.rootSpanType ?? "agent",
        status: richArrival.status,
        input: richArrival.input,
        output: richArrival.output,
      },
      {
        traceId: "lw-preview-arrival-conv-next",
        timestamp: richArrival.timestamp + 90_000,
        name: "mastra.agent.run",
        rootSpanType: "agent",
        status: "ok",
        input:
          "Re-enable the email-jobs runner now and ping me when it's caught up.",
        output:
          "Done — email-jobs is unpaused as of 09:42 UTC. Backlog is ~4,800 abandonment emails; estimated catch-up in 12 minutes. I'll ping you the moment the queue drains.",
      },
    ],
  };
}

/**
 * Evaluations attached to the rich preview trace. Two pass results
 * (relevance, faithfulness) and one skipped result so the eval tab shows
 * the three real states the empty-state experience wants to teach.
 */
function buildRichArrivalEvaluations(): EvaluationRunData[] {
  const completedAt = richArrival.timestamp + richArrival.durationMs;
  return [
    {
      evaluationId: "eval-relevance-arrival-01",
      evaluatorId: "lw-relevance",
      evaluatorType: "langevals/answer_relevance",
      evaluatorName: "Answer relevance",
      traceId: richArrival.traceId,
      isGuardrail: false,
      status: "processed",
      score: 0.93,
      passed: true,
      label: null,
      details:
        "The answer directly addresses the funnel-drop question, names the two contributing causes with quantified impact, and recommends an immediate fix. Stayed on the user's framing throughout.",
      inputs: {
        question: richArrival.input,
        answer: richArrival.output,
      },
      error: null,
      errorDetails: null,
      createdAt: completedAt,
      updatedAt: completedAt,
      lastEventOccurredAt: completedAt,
      archivedAt: null,
      scheduledAt: completedAt - 200,
      startedAt: completedAt - 180,
      completedAt,
      costId: null,
    },
    {
      evaluationId: "eval-faithfulness-arrival-01",
      evaluatorId: "ragas-faithfulness",
      evaluatorType: "ragas/faithfulness",
      evaluatorName: "Faithfulness",
      traceId: richArrival.traceId,
      isGuardrail: false,
      status: "processed",
      score: 0.89,
      passed: true,
      label: null,
      details:
        "Two claims grounded directly in the deploy log (checkout v2 rollout at 09:14Z + #4421, email-jobs paused at 08:30Z). One inference ('≈12pp / ≈6pp') is a reasonable apportionment from the funnel-metrics breakdown but not literally a single line in the retrieved context.",
      inputs: {
        question: richArrival.input,
        answer: richArrival.output,
        contexts: [
          "deploy-log @ 09:14Z: checkout rollout_100 v2.4.0 — open issue #4421 paypal redirect ios safari",
          "deploy-log @ 08:30Z: email-jobs paused for db migration",
        ],
      },
      error: null,
      errorDetails: null,
      createdAt: completedAt + 10,
      updatedAt: completedAt + 10,
      lastEventOccurredAt: completedAt + 10,
      archivedAt: null,
      scheduledAt: completedAt - 200,
      startedAt: completedAt - 150,
      completedAt: completedAt + 10,
      costId: null,
    },
    {
      evaluationId: "eval-toxicity-arrival-01",
      evaluatorId: "lw-toxicity",
      evaluatorType: "langevals/toxicity",
      evaluatorName: "Toxicity",
      traceId: richArrival.traceId,
      isGuardrail: true,
      status: "skipped",
      score: null,
      passed: null,
      label: null,
      details:
        "Skipped — guardrail short-circuited because the response was below the configured threshold for content-safety review.",
      inputs: { answer: richArrival.output },
      error: null,
      errorDetails: null,
      createdAt: completedAt + 20,
      updatedAt: completedAt + 20,
      lastEventOccurredAt: completedAt + 20,
      archivedAt: null,
      scheduledAt: completedAt - 200,
      startedAt: null,
      completedAt: completedAt + 20,
      costId: null,
    },
  ];
}

/**
 * Single object aggregating every detail payload the drawer needs for the
 * rich arrival trace. Consumed by `useOpenTraceDrawer` to seed each
 * relevant tRPC cache before opening the drawer.
 */
export interface RichArrivalTraceDetail {
  header: TraceHeader;
  spanTree: SpanTreeNode[];
  spanDetails: SpanDetail[];
  spansFull: SpanDetail[];
  conversation: RichArrivalConversationContext;
  evaluations: EvaluationRunData[];
}

export function buildRichArrivalTraceDetail(): RichArrivalTraceDetail {
  return {
    header: buildRichArrivalHeader(),
    spanTree: RICH_ARRIVAL_SPAN_TREE,
    spanDetails: RICH_ARRIVAL_SPAN_DETAILS,
    // `spansFull` returns the same shape as `spanDetail` per span — reuse
    // the detail set so the LLM-optimised view has everything in cache.
    spansFull: RICH_ARRIVAL_SPAN_DETAILS,
    conversation: buildRichArrivalConversationContext(),
    evaluations: buildRichArrivalEvaluations(),
  };
}
