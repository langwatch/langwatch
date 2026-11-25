/**
 * Every widget the library defines: the question it answers, who it is for and what it needs.
 * Generated from the dashboards library draft on 2026-10-06; edit here from now on.
 */

import type { AgentKind, CatalogueScope, Persona, QuestionType } from "./catalogue-labels.ts";

/** built: code exists; ready: today's data; logic: new query code; feature: waits for LangWatch. */
export type CatalogueBuild = "built" | "ready" | "logic" | "feature";

export interface CatalogueWidget {
  readonly id: string;
  /** Where the design came from: our PR, Rogerio's prototype, or proposed by the library. */
  readonly origin: "pr" | "prototype" | "proposed";
  readonly question: string;
  readonly title: string;
  readonly why: string;
  readonly questionId: string;
  readonly alsoAnswers: readonly string[];
  readonly questionType: QuestionType;
  readonly personas: readonly Persona[];
  readonly agentKinds: readonly AgentKind[];
  /** Each entry is one requirement; its keys are alternatives, any one of which will do. */
  readonly requirements: readonly (readonly string[])[];
  readonly build: CatalogueBuild;
  readonly scope: CatalogueScope;
  /** What Langy is asked when the widget is added; the member can edit it first. */
  readonly prompt: string;
}

/** Made for coding agents, or reads their traces: those widgets live with coding agents. */
export const isCodingWidget = (widget: CatalogueWidget): boolean =>
  widget.agentKinds.includes("coding") ||
  widget.requirements.some((keys) => keys.includes("coding"));

export const CATALOGUE_WIDGETS: readonly CatalogueWidget[] = [
  {
    id: "traffic",
    origin: "pr",
    question: "How busy is my agent?",
    title: "How busy is my agent?",
    why: "Requests per day, the total for the period, and the busiest and quietest days.",
    questionId: "used",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["product", "ops"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["traces"]],
    build: "built",
    scope: "project",
    prompt:
      "How busy is my agent? Query the LangWatchQL view trace_metrics over the dashboard period, " +
      "bucketed at the dashboard grain: count traces with uniqExact(TraceId) per bucket of " +
      "OccurredAt. Answer with the total for the period, the busiest and the quietest bucket " +
      "with their counts, and a short series of traces per bucket. Quote the real numbers from " +
      "the query result. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period rather than guessing.",
  },
  {
    id: "satisfaction-shift",
    origin: "pr",
    question: "Are users happier than before?",
    title: "Are users happier than before?",
    why: "Average user satisfaction per day, against the period before.",
    questionId: "happy",
    alsoAnswers: [],
    questionType: "changed",
    personas: ["product", "ops"],
    agentKinds: ["support-bot", "rag", "voice", "tools-agent"],
    requirements: [],
    build: "built",
    scope: "project",
    prompt:
      "Are users happier than before? Query the LangWatchQL view traces over the dashboard " +
      "period, bucketed at the dashboard grain: avg(SatisfactionScore) per bucket of OccurredAt, " +
      "skipping rows where SatisfactionScore is null. Compare the last seven days with the seven " +
      "days before them. Answer with the two averages, the change between them, and the bucket " +
      "where the score moved most. Quote the real numbers from the query result. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period rather than " +
      "guessing.",
  },
  {
    id: "token-drift",
    origin: "pr",
    question: "Is my agent using more tokens over time?",
    title: "Is my agent using more tokens over time?",
    why: "Input and output tokens per day, and how much the total moved.",
    questionId: "spend",
    alsoAnswers: ["change"],
    questionType: "changed",
    personas: ["eng", "finance"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [],
    build: "built",
    scope: "project",
    prompt:
      "Is my agent using more tokens over time? Query the LangWatchQL view trace_metrics " +
      "over the dashboard period, bucketed at the dashboard grain: sum(PromptTokens) and " +
      "sum(CompletionTokens) per bucket of OccurredAt. Answer with the first and last bucket's " +
      "prompt and completion tokens, the change between them as a percentage, and whether the " +
      "trend is up, flat or down. Quote the real numbers from the query result. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period rather " +
      "than guessing.",
  },
  {
    id: "conversation-length",
    origin: "pr",
    question: "Are conversations getting longer?",
    title: "Are conversations getting longer?",
    why: "Average messages per conversation per day, and the change over the period.",
    questionId: "depth",
    alsoAnswers: [],
    questionType: "changed",
    personas: ["product"],
    agentKinds: ["support-bot", "rag", "voice", "tools-agent"],
    requirements: [],
    build: "built",
    scope: "project",
    prompt:
      "Are conversations getting longer? Query the LangWatchQL view trace_metrics over the " +
      "dashboard period, bucketed at the dashboard grain: per bucket of OccurredAt, count " +
      "uniqExact(TraceId) for each non-empty ConversationId, then average those counts. Answer " +
      "with a series of average traces per conversation per bucket, and the change from the " +
      "first bucket to the last. Quote the real numbers from the query result. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period rather than " +
      "guessing.",
  },
  {
    id: "latency-slo",
    origin: "pr",
    question: "When was my agent slower than usual?",
    title: "When was my agent slower than usual?",
    why: "Slowest response times per day, with the days well above normal picked out.",
    questionId: "fast",
    alsoAnswers: [],
    questionType: "line",
    personas: ["eng", "ops"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["traces"]],
    build: "built",
    scope: "project",
    prompt:
      "When was my agent slower than usual? Query the LangWatchQL view trace_metrics over the " +
      "dashboard period, bucketed at the dashboard grain: quantileExact(0.95)(TotalDurationMs) " +
      "per bucket of OccurredAt. Answer with the p95 in milliseconds for the latest bucket and " +
      "for the whole period, and list the buckets well above the period's p95. No target is " +
      "stored, so ask me for mine if I have not given one. Quote the real numbers from the query " +
      "result. If a query returns no rows, say plainly that there is no data for the dashboard " +
      "period rather than guessing.",
  },
  {
    id: "error-rate",
    origin: "pr",
    question: "Is my agent failing more often?",
    title: "Is my agent failing more often?",
    why: "The share of requests that end in an error, day by day, and whether it is going up.",
    questionId: "failing",
    alsoAnswers: [],
    questionType: "changed",
    personas: ["eng", "ops"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["errors"]],
    build: "built",
    scope: "project",
    prompt:
      "Is my agent failing more often? Query the LangWatchQL view trace_metrics over the " +
      "dashboard period, bucketed at the dashboard grain: countIf(HasError) / count() per bucket " +
      "of OccurredAt. Then query spans where StatusCode = 2 for the top five error types from " +
      "SpanAttributes['exception.type'] with their SpanName and count. Answer with the error " +
      "rate series, the first and last bucket's rate, and a top-five table of error types. Quote " +
      "the real numbers from the query result. If a query returns no rows, say plainly that " +
      "there is no data for the dashboard period rather than guessing.",
  },
  {
    id: "latency-spread",
    origin: "pr",
    question: "How fast does my agent answer?",
    title: "How fast does my agent answer?",
    why: "Typical and slowest response times, and how far apart they are.",
    questionId: "fast",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["eng"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["traces"]],
    build: "built",
    scope: "project",
    prompt:
      "How fast does my agent answer? Query the LangWatchQL view trace_metrics over the " +
      "dashboard period: quantileExact at 0.5, 0.9 and 0.99 of TotalDurationMs, for the whole " +
      "period and per bucket of OccurredAt at the dashboard grain. Answer with p50, p90 and p99 " +
      "in milliseconds for the period, the ratio of p99 to p50, and the bucket with the longest " +
      "tail. Quote the real numbers from the query result. If a query returns no rows, say " +
      "plainly that there is no data for the dashboard period rather than guessing.",
  },
  {
    id: "spend",
    origin: "pr",
    question: "How much is my agent costing me?",
    title: "How much is my agent costing me?",
    why: "Spend per day, the total for the period and the most expensive day.",
    questionId: "spend",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["finance", "eng", "leader"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [],
    build: "built",
    scope: "project",
    prompt:
      "How much is my agent costing me? Query the LangWatchQL view trace_metrics over the " +
      "dashboard period, bucketed at the dashboard grain: sum(TotalCost) per bucket of " +
      "OccurredAt. Then, from trace_metrics over the same period, arrayJoin(Models) and sum " +
      "TotalCost / length(Models) by model. Answer with total spend in USD, the most expensive " +
      "bucket, and a top-five table of models by cost with each one's share of the total. " +
      "Quote the real numbers from the query result. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period rather than guessing.",
  },
  {
    id: "top-models",
    origin: "pr",
    question: "Which models does my agent use?",
    title: "Which models does my agent use?",
    why: "The ten models used most, their share of model requests and their cost.",
    questionId: "spend",
    alsoAnswers: ["less"],
    questionType: "matters",
    personas: ["eng", "prompt"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["model"]],
    build: "built",
    scope: "project",
    prompt:
      "Which models does my agent use? Query the LangWatchQL view trace_metrics over the " +
      "dashboard period: arrayJoin(Models) and count uniqExact(TraceId) per model. Add each " +
      "model's cost from trace_metrics over the same period: arrayJoin(Models) and sum " +
      "TotalCost / length(Models). Answer with a top-10 table of models: traces, share of the " +
      "traces that call a model, and cost in USD. Quote the real numbers from the query " +
      "result. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period rather than guessing.",
  },
  {
    id: "lowest-passing-evaluators",
    origin: "pr",
    question: "Which checks fail most often?",
    title: "Which checks fail most often?",
    why: "The five quality checks with the lowest pass rate, and how often each ran.",
    questionId: "judges",
    alsoAnswers: ["answers"],
    questionType: "matters",
    personas: ["qa", "expert"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["evals"]],
    build: "built",
    scope: "project",
    prompt:
      "Which checks fail most often? Answer it with LangWatchQL over the dashboard period. What " +
      "the answer shows: The five evaluators with the lowest pass rate, with their run counts. " +
      "It needs: evaluator results. Quote the real numbers from the query result and name the " +
      "traces behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "scenarios",
    origin: "pr",
    question: "Does my agent still pass its test scenarios?",
    title: "Does my agent still pass its test scenarios?",
    why: "The share of scenario runs that passed, for the period and day by day.",
    questionId: "tests",
    alsoAnswers: [],
    questionType: "changed",
    personas: ["qa", "eng"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["scenarios"]],
    build: "built",
    scope: "project",
    prompt:
      "Does my agent still pass its test scenarios? Query the LangWatchQL view simulations over " +
      "the dashboard period, bucketed at the dashboard grain: rows where ArchivedAt is null and " +
      "Verdict is not null, by bucket of StartedAt, with countIf(Verdict = 'success') / count() " +
      "as the pass rate, and the same per ScenarioSetId. Answer with the pass rate and run count " +
      "for the period, its series per bucket, and a top-five table of suites by runs. Quote the " +
      "real numbers from the query result. If a query returns no rows, say plainly that there is " +
      "no data for the dashboard period rather than guessing.",
  },
  {
    id: "topics",
    origin: "pr",
    question: "What do users ask my agent about?",
    title: "What do users ask my agent about?",
    why: "The ten most common topics, their share, and the one growing fastest.",
    questionId: "used",
    alsoAnswers: ["asking"],
    questionType: "matters",
    personas: ["product", "ops", "expert"],
    agentKinds: ["support-bot", "rag", "voice", "tools-agent"],
    requirements: [],
    build: "built",
    scope: "project",
    prompt:
      "What do users ask my agent about? Query the LangWatchQL view trace_metrics over the " +
      "dashboard period: uniqExact(TraceId) per non-empty TopicId, joined to the topics view for " +
      "TopicName. Answer with a top-10 table of topics: name, traces and share of all traces " +
      "with a topic, and name the one topic that grew most across the period. Quote the real " +
      "numbers from the query result. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period rather than guessing.",
  },
  {
    id: "slowest-models",
    origin: "pr",
    question: "Which model slows my agent down?",
    title: "Which model slows my agent down?",
    why: "The five models with the slowest responses.",
    questionId: "fast",
    alsoAnswers: ["less"],
    questionType: "compare",
    personas: ["eng", "prompt"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["model"]],
    build: "built",
    scope: "project",
    prompt:
      "Which model slows my agent down? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: The five models whose traces have the slowest-5% latency. It " +
      "needs: model name. Quote the real numbers from the query result and name the traces " +
      "behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "thumbs-down",
    origin: "pr",
    question: "Which answers did my reviewers mark as bad?",
    title: "Which answers did my reviewers mark as bad?",
    why: "The share of answers your team marked down, and the latest ones.",
    questionId: "answers",
    alsoAnswers: ["testset"],
    questionType: "matters",
    personas: ["expert", "qa"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["annotations"]],
    build: "built",
    scope: "project",
    prompt:
      "Which answers did my reviewers mark as bad? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Share of reviewer thumbs down, then the latest traces " +
      "marked down. The widget reads reviewer annotations, not end-user feedback; the PR label " +
      "says otherwise. It needs: reviewer annotations. Quote the real numbers from the query " +
      "result and name the traces behind them. If a query returns no rows, say plainly that " +
      "there is no data for the dashboard period.",
  },
  {
    id: "lowest-scores",
    origin: "pr",
    question: "Which answers scored worst?",
    title: "Which answers scored worst?",
    why: "The eight answers with the lowest quality score, each one click from the full conversation.",
    questionId: "answers",
    alsoAnswers: ["testset"],
    questionType: "why",
    personas: ["expert", "qa"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["evals"]],
    build: "built",
    scope: "project",
    prompt:
      "Which answers scored worst? Answer it with LangWatchQL over the dashboard period. What " +
      "the answer shows: The eight evaluation results with the lowest score, each linked to its " +
      "trace. It needs: evaluator results. Quote the real numbers from the query result and name " +
      "the traces behind them. If a query returns no rows, say plainly that there is no data for " +
      "the dashboard period.",
  },
  {
    id: "evaluation-coverage",
    origin: "pr",
    question: "How much of my traffic gets checked?",
    title: "How much of my traffic gets checked?",
    why: "What each quality check runs on, its pass rate, and the share of requests checked at all.",
    questionId: "judges",
    alsoAnswers: ["answers"],
    questionType: "matters",
    personas: ["qa"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["evals"]],
    build: "built",
    scope: "project",
    prompt:
      "How much of my traffic gets checked? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: What each evaluator runs on, its pass rate, and the share " +
      "of traces evaluated at all. It needs: evaluator results. Quote the real numbers from the " +
      "query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "fd-throughput",
    origin: "pr",
    question: "How do volume, speed and errors move together?",
    title: "How do volume, speed and errors move together?",
    why: "Requests per day as bars, slowest response time as a line and the error rate as a band.",
    questionId: "used",
    alsoAnswers: ["fast", "failing"],
    questionType: "happened",
    personas: ["eng", "ops"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["traces"]],
    build: "built",
    scope: "project",
    prompt:
      "How do volume, speed and errors move together? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Traces per bucket as bars, slowest-5% latency as " +
      "a line and the error rate as a ribbon. It needs: traces. Quote the real numbers from the " +
      "query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "fd-cost-efficiency",
    origin: "pr",
    question: "What does each request without an error cost me?",
    title: "What does each request without an error cost me?",
    why: "Cost per request without an error, tokens in and out, and the five most expensive models. Whether an answer was right needs a scored outcome, and the card offers to set one up.",
    questionId: "spend",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["finance", "eng"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["model"]],
    build: "built",
    scope: "project",
    prompt:
      "What does each request without an error cost me? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Cost per request without an error, tokens in " +
      "and out, and the five models that cost the most. No error does not mean the answer was " +
      "right: say so, and that whether it was needs the conversation outcome judge or an " +
      "outcome my app sends. It needs: cost and tokens; model name. Quote the real numbers " +
      "from the query result and name the traces behind them. If a query returns no rows, say " +
      "plainly that there is no data for the dashboard period.",
  },
  {
    id: "fd-failures",
    origin: "pr",
    question: "Which errors happen most?",
    title: "Which errors happen most?",
    why: "Errors grouped by type and where they happen, most frequent first.",
    questionId: "failing",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["eng", "ops"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["errors"]],
    build: "built",
    scope: "project",
    prompt:
      "Which errors happen most? Answer it with LangWatchQL over the dashboard period. What the " +
      "answer shows: Error spans grouped by exception or error type and operation, most frequent " +
      "first. The same query backs the “Top error types” widget. It needs: error status on " +
      "spans. Quote the real numbers from the query result and name the traces behind them. If a " +
      "query returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "fd-quality",
    origin: "pr",
    question: "Is quality holding while errors move?",
    title: "Is quality holding while errors move?",
    why: "Quality check pass rate over time, drawn against the error rate.",
    questionId: "answers",
    alsoAnswers: [],
    questionType: "changed",
    personas: ["qa", "product"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["evals"]],
    build: "built",
    scope: "project",
    prompt:
      "Is quality holding while errors move? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Evaluator pass rate over time, drawn against the trace " +
      "error rate of the same buckets. It needs: evaluator results. Quote the real numbers from " +
      "the query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "fd-feedback",
    origin: "pr",
    question: "What does my team think of my agent's answers?",
    title: "What does my team think of my agent's answers?",
    why: "Thumbs up and down from your reviewers, and the share of good answers over time.",
    questionId: "answers",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["qa", "expert"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["annotations"]],
    build: "built",
    scope: "project",
    prompt:
      "What does my team think of my agent's answers? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Reviewer thumbs up and down, then the positive " +
      "share over time. The widget reads reviewer annotations, not end-user feedback; the PR " +
      "label says otherwise. It needs: reviewer annotations. Quote the real numbers from the " +
      "query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "fd-gateway",
    origin: "pr",
    question: "Which AI gateway keys spend the most?",
    title: "Which AI gateway keys spend the most?",
    why: "Gateway spend per key (one key per app, team or customer), top five.",
    questionId: "orgspend",
    alsoAnswers: ["acctcost"],
    questionType: "matters",
    personas: ["finance", "eng"],
    agentKinds: [],
    requirements: [["gateway"]],
    build: "built",
    scope: "org",
    prompt:
      "Which AI gateway keys spend the most? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Gateway spend per virtual key (one key per app, team or " +
      "customer), the five that spend the most. It needs: gateway traffic. Quote the real " +
      "numbers from the query result and name the traces behind them. If a query returns no " +
      "rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "fd-coding-agents",
    origin: "pr",
    question:
      "What does each coding tool cost the team, and how often do its sessions hit an error?",
    title: "What does each coding tool cost the team, and how often do its sessions hit an error?",
    why: "Sessions, cost and the share of sessions without an error for each coding tool your developers use, with the trend.",
    questionId: "codingcost",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["eng", "finance"],
    agentKinds: [],
    requirements: [["coding"]],
    build: "built",
    scope: "org",
    prompt:
      "What does each coding tool cost the team, and how often do its sessions hit an error? " +
      "Answer it with LangWatchQL over the dashboard period. What the answer shows: Sessions, " +
      "tokens, cost and the share of sessions without an API, internal or retry-exhausted " +
      "error per coding agent, with its session trend. A session without an error did not " +
      "necessarily finish the job. It needs: coding-agent traces. Quote the real numbers from " +
      "the query result and name the traces behind them. If a query returns no rows, say " +
      "plainly that there is no data for the dashboard period.",
  },
  {
    id: "ck-kpis",
    origin: "prototype",
    question: "Is my agent doing its job?",
    title: "Is my agent doing its job?",
    why: "How often it gets the job done (a resolved conversation, a correct document, a finished call), how much it is used and what each good result costs, against the period before.",
    questionId: "finish",
    alsoAnswers: ["outcomecost", "used"],
    questionType: "changed",
    personas: ["leader", "product", "ops"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["judge", "outcome"], ["evals"]],
    build: "feature",
    scope: "project",
    prompt:
      "Is my agent doing its job? Answer it with LangWatchQL over the dashboard period. What the " +
      "answer shows: Four numbers against the period before: how often my agent succeeds in its " +
      "own terms (resolved conversations, correct documents, completed calls), how much my agent " +
      "is used, the share of automatic checks that pass, and the cost of one success. It needs: " +
      "conversation outcome judge or outcome event; evaluator results; cost and tokens. Quote " +
      "the real numbers from the query result and name the traces behind them. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "ck-status",
    origin: "prototype",
    question: "Is my agent working right now?",
    title: "Is my agent working right now?",
    why: "Requests, the share without an error, response time and cost, against the period before.",
    questionId: "failing",
    alsoAnswers: ["fast"],
    questionType: "line",
    personas: ["eng", "ops"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["errors"]],
    build: "logic",
    scope: "project",
    prompt:
      "Is my agent working right now? Query the LangWatchQL view trace_metrics over the " +
      "dashboard period and over the equally long period right before it. Report traces " +
      "(uniqExact(TraceId)), the share of traces without an error (HasError is false; no " +
      "error does not mean the answer was right, so never call it a rate of good answers), " +
      "p95 latency (quantileExact(0.95) of TotalDurationMs) and total cost (sum of " +
      "TotalCost). Answer with " +
      "one line per measure: its value now and its change against the previous period, as a " +
      "number and a percentage. Quote the real numbers from the query result. If a query returns " +
      "no rows, say plainly that there is no data for the dashboard period rather than guessing.",
  },
  {
    id: "ck-attention",
    origin: "prototype",
    question: "What should I fix first this week?",
    title: "What should I fix first this week?",
    why: "The one problem that grew most this week, with the conversations that show it.",
    questionId: "finish",
    alsoAnswers: ["answers", "change"],
    questionType: "matters",
    personas: ["product", "ops", "eng"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["evals"], ["labels", "customer", "topics"]],
    build: "logic",
    scope: "project",
    prompt:
      "What should I fix first this week? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Names the single biggest problem and links to its traces. It " +
      "tries, in order: the topic or customer whose pass rate fell most this week (beyond normal " +
      "noise); the failure reason that grew most; an automatic grader that stopped agreeing with " +
      "human reviewers; the step that fails most. It needs: evaluator results; labels or " +
      "metadata or customer id or topics. Quote the real numbers from the query result and name " +
      "the traces behind them. If a query returns no rows, say plainly that there is no data for " +
      "the dashboard period.",
  },
  {
    id: "ck-top-ask",
    origin: "prototype",
    question: "What do users ask for most that my agent can't do?",
    title: "What do users ask for most that my agent can't do?",
    why: "The top request your agent has no way to serve, how often it comes up, and an example.",
    questionId: "asking",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["product"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["judge"]],
    build: "logic",
    scope: "project",
    prompt:
      "What do users ask for most that my agent can't do? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: The topic users ask for most that my agent has " +
      "no way to serve, how often, and one example request. An automatic grader marks these " +
      "conversations. It needs: conversation outcome judge; topics. Quote the real numbers from " +
      "the query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "ck-trend",
    origin: "prototype",
    question: "Does my agent resolve more conversations each day?",
    title: "Does my agent resolve more conversations each day?",
    why: "The share of finished conversations that went well, per day, with your changes marked.",
    questionId: "finish",
    alsoAnswers: [],
    questionType: "changed",
    personas: ["product", "ops", "leader"],
    agentKinds: ["support-bot", "rag", "extraction", "tools-agent", "vendor", "regulated"],
    requirements: [["judge", "outcome"]],
    build: "logic",
    scope: "project",
    prompt:
      "Does my agent resolve more conversations each day? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Share of closed conversations that went well, " +
      "per day, with prompt, model and deploy changes marked on the line. It needs: conversation " +
      "outcome judge or outcome event. Quote the real numbers from the query result and name the " +
      "traces behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "up-errors",
    origin: "prototype",
    question: "Did a change start new errors?",
    title: "Did a change start new errors?",
    why: "Failed requests per day by error type, with prompt, model and deploy changes marked on the chart.",
    questionId: "failing",
    alsoAnswers: [],
    questionType: "why",
    personas: ["eng"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "generative", "vendor", "regulated"],
    requirements: [["errors"]],
    build: "ready",
    scope: "project",
    prompt:
      "Did a change start new errors? Answer it with LangWatchQL over the dashboard period. What " +
      "the answer shows: Failed traces per day split by error type, the error rate as a line, " +
      "and prompt, model and deploy changes marked. A spike that starts at a change points to " +
      "that change. It needs: error status on spans. Quote the real numbers from the query " +
      "result and name the traces behind them. If a query returns no rows, say plainly that " +
      "there is no data for the dashboard period.",
  },
  {
    id: "up-where-fails",
    origin: "prototype",
    question: "Which step or tool fails most?",
    title: "Which step or tool fails most?",
    why: "How often each step and tool call fails, and how often the agent did not recover from it.",
    questionId: "failing",
    alsoAnswers: ["tools"],
    questionType: "matters",
    personas: ["eng"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "generative", "vendor", "regulated"],
    requirements: [["steps"], ["errors"]],
    build: "ready",
    scope: "project",
    prompt:
      "Which step or tool fails most? Answer it with LangWatchQL over the dashboard period. What " +
      "the answer shows: Each step and tool call: how often it fails, and how often my agent did " +
      "not recover (no later retry or fallback fixed it). Fix the one with the most unrecovered " +
      "failures. It needs: tool and step spans; error status on spans. Quote the real numbers " +
      "from the query result and name the traces behind them. If a query returns no rows, say " +
      "plainly that there is no data for the dashboard period.",
  },
  {
    id: "up-failing-traces",
    origin: "prototype",
    question: "Which requests failed or ran slowest?",
    title: "Which requests failed or ran slowest?",
    why: "The requests that failed or took longest this period. Each opens at the step that broke.",
    questionId: "trace",
    alsoAnswers: ["failing"],
    questionType: "happened",
    personas: ["eng", "ops"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["traces"]],
    build: "ready",
    scope: "project",
    prompt:
      "Which requests failed or ran slowest? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: The traces that failed or ran slowest in this period. Each " +
      "opens to the step that broke. It needs: traces. Quote the real numbers from the query " +
      "result and name the traces behind them. If a query returns no rows, say plainly that " +
      "there is no data for the dashboard period.",
  },
  {
    id: "up-step-latency",
    origin: "prototype",
    question: "Which step makes my agent slow?",
    title: "Which step makes my agent slow?",
    why: "Typical and slowest time for each step, so you can see which step holds most of the wait.",
    questionId: "fast",
    alsoAnswers: [],
    questionType: "why",
    personas: ["eng"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["steps"]],
    build: "ready",
    scope: "project",
    prompt:
      "Which step makes my agent slow? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Typical and slowest-5% time for each step of a trace. The step " +
      "that holds most of the slow time is the one to shorten. It needs: tool and step spans. " +
      "Quote the real numbers from the query result and name the traces behind them. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "up-loops",
    origin: "prototype",
    question: "Does my agent go in circles?",
    title: "Does my agent go in circles?",
    why: "Requests where the agent repeats the same tool call 3 or more times, and what the repeats cost.",
    questionId: "tools",
    alsoAnswers: ["spend"],
    questionType: "happened",
    personas: ["eng"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["steps"]],
    build: "logic",
    scope: "project",
    prompt:
      "Does my agent go in circles? Answer it with LangWatchQL over the dashboard period. What " +
      "the answer shows: Traces where my agent calls the same tool with the same input 3 or more " +
      "times, or retries a step, and what the repeats cost. It needs: tool and step spans; cost " +
      "and tokens. Quote the real numbers from the query result and name the traces behind them. " +
      "If a query returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "ans-outcomes",
    origin: "prototype",
    question: "How do conversations with my agent end?",
    title: "How do conversations with my agent end?",
    why: "Resolved, misunderstood, could not help, refused or handed to a person, day by day.",
    questionId: "finish",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["ops", "product"],
    agentKinds: [
      "support-bot",
      "voice",
      "extraction",
      "tools-agent",
      "generative",
      "vendor",
      "regulated",
    ],
    requirements: [["judge", "outcome"]],
    build: "logic",
    scope: "project",
    prompt:
      "How do conversations with my agent end? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Closed conversations per day by how they ended: resolved, " +
      "misunderstood, could not do the task, refused without reason, handed to a person. An " +
      "outcome my app sends wins; otherwise an automatic grader decides. It needs: conversation " +
      "outcome judge or outcome event; conversation id. Quote the real numbers from the query " +
      "result and name the traces behind them. If a query returns no rows, say plainly that " +
      "there is no data for the dashboard period.",
  },
  {
    id: "ans-evaluators",
    origin: "prototype",
    question: "Are my agent's answers good enough?",
    title: "Are my agent's answers good enough?",
    why: "The share of answers that pass your quality checks, such as correct, on topic and polite, day by day. You can click a check to see the answers that failed.",
    questionId: "answers",
    alsoAnswers: [],
    questionType: "line",
    personas: ["qa", "eng"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["evals"]],
    build: "ready",
    scope: "project",
    prompt:
      "Are my agent's answers good enough? Query the LangWatchQL view evaluation_metrics over " +
      "the dashboard period, bucketed at the dashboard grain: countIf(Passed = 1) / count() per " +
      "bucket of OccurredAt, skipping rows where Passed is null, and the same pass rate per " +
      "EvaluatorName. Answer with the pass rate for the period, its series per bucket, and a " +
      "table of the five evaluators with the lowest pass rate and their run counts. Quote the " +
      "real numbers from the query result. If a query returns no rows, say plainly that there is " +
      "no data for the dashboard period rather than guessing.",
  },
  {
    id: "ans-topics",
    origin: "prototype",
    question: "Which topics does my agent handle well, and which badly?",
    title: "Which topics does my agent handle well, and which badly?",
    why: "For each topic: how many conversations, the share that went well, and the requests it could not serve.",
    questionId: "asking",
    alsoAnswers: ["answers"],
    questionType: "compare",
    personas: ["product", "ops", "expert"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["evals", "judge"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which topics does my agent handle well, and which badly? Answer it with LangWatchQL over " +
      "the dashboard period. What the answer shows: For each topic users ask about: how many " +
      "conversations, the share that went well (graded on a sample), and requests my agent could " +
      "not serve. It needs: topics; evaluator results or conversation outcome judge. Quote the " +
      "real numbers from the query result and name the traces behind them. If a query returns no " +
      "rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "ans-idk",
    origin: "prototype",
    question: "Where does my agent fail to answer?",
    title: "Where does my agent fail to answer?",
    why: "The share of conversations per topic where the agent gave no answer or refused. Add content or tools for the top ones.",
    questionId: "answers",
    alsoAnswers: ["grounded"],
    questionType: "matters",
    personas: ["expert", "product"],
    agentKinds: ["support-bot", "rag", "voice", "vendor", "regulated"],
    requirements: [["judge"]],
    build: "logic",
    scope: "project",
    prompt:
      "Where does my agent fail to answer? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Share of conversations per topic where my agent gave no answer or " +
      "refused. Add content or tools for the topics at the top. It needs: conversation outcome " +
      "judge; topics. Quote the real numbers from the query result and name the traces behind " +
      "them. If a query returns no rows, say plainly that there is no data for the dashboard " +
      "period.",
  },
  {
    id: "ans-review",
    origin: "prototype",
    question: "Which conversations should a person check?",
    title: "Which conversations should a person check?",
    why: "Failed or flagged conversations from the last 3 days, plus a random sample, each with the reason it was picked.",
    questionId: "answers",
    alsoAnswers: ["testset", "judges"],
    questionType: "matters",
    personas: ["expert", "qa"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["evals", "thumbs"]],
    build: "ready",
    scope: "project",
    prompt:
      "Which conversations should a person check? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: A queue from the last 3 days: conversations that failed or " +
      "were flagged, plus 1 in 5 picked at random as a check, each with the grader's reason. Bad " +
      "ones go into a test dataset. It needs: evaluator results or end-user thumbs events. Quote " +
      "the real numbers from the query result and name the traces behind them. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "ask-cannot",
    origin: "prototype",
    question: "What do users want that my agent can't do?",
    title: "What do users want that my agent can't do?",
    why: "Requests per topic that the agent had no tool or content for: what users want it to do next.",
    questionId: "asking",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["product"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["judge"]],
    build: "logic",
    scope: "project",
    prompt:
      "What do users want that my agent can't do? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Requests per topic that an automatic grader marked as out " +
      "of reach: my agent has no tool or content for them. These are product gaps, not bugs. It " +
      "needs: conversation outcome judge; topics. Quote the real numbers from the query result " +
      "and name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
  {
    id: "ask-rising",
    origin: "prototype",
    question: "Which topics are users asking about more?",
    title: "Which topics are users asking about more?",
    why: "Topics that grew against the period before, and topics that are new.",
    questionId: "used",
    alsoAnswers: ["asking"],
    questionType: "changed",
    personas: ["product", "ops"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [],
    build: "logic",
    scope: "project",
    prompt:
      "Which topics are users asking about more? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Topics whose share of conversations grew against the " +
      "previous period of the same length, and topics that are new. It needs: topics. Quote the " +
      "real numbers from the query result and name the traces behind them. If a query returns no " +
      "rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "ask-again",
    origin: "prototype",
    question: "Do users have to ask twice?",
    title: "Do users have to ask twice?",
    why: "The share of conversations per day where the user rephrased because the first answer missed.",
    questionId: "happy",
    alsoAnswers: ["comeback"],
    questionType: "happened",
    personas: ["product", "expert"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["judge"]],
    build: "logic",
    scope: "project",
    prompt:
      "Do users have to ask twice? Answer it with LangWatchQL over the dashboard period. What " +
      "the answer shows: Share of conversations per day where the user rephrased after a missed " +
      "answer, and how many users came back. It needs: conversation id; user id; conversation " +
      "outcome judge. Quote the real numbers from the query result and name the traces behind " +
      "them. If a query returns no rows, say plainly that there is no data for the dashboard " +
      "period.",
  },
  {
    id: "ship-verdict",
    origin: "prototype",
    question: "Is the new version ready to ship?",
    title: "Is the new version ready to ship?",
    why: "The new version's test results against the current one on the same scenarios: what got worse, and the change in cost and speed.",
    questionId: "change",
    alsoAnswers: ["tests"],
    questionType: "prove",
    personas: ["qa", "eng", "product"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["scenarios", "experiments"]],
    build: "logic",
    scope: "project",
    prompt:
      "Is the new version ready to ship? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: The new version's test runs against the current version's on the " +
      "same scenarios: pass rate, the scenarios that got worse by more than their normal " +
      "flakiness, and the change in cost and response time. Ship when nothing got worse. It " +
      "needs: scenario runs or experiment runs. Quote the real numbers from the query result and " +
      "name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
  {
    id: "ship-compare",
    origin: "prototype",
    question: "How do my last test runs compare?",
    title: "How do my last test runs compare?",
    why: "Your last five test runs side by side: scenarios passed, scores, cost and reply time.",
    questionId: "tests",
    alsoAnswers: ["less"],
    questionType: "compare",
    personas: ["qa", "prompt", "eng"],
    agentKinds: [
      "support-bot",
      "rag",
      "extraction",
      "tools-agent",
      "generative",
      "vendor",
      "regulated",
    ],
    requirements: [["experiments", "scenarios"]],
    build: "ready",
    scope: "project",
    prompt:
      "How do my last test runs compare? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: The last five test runs side by side against a baseline I choose: " +
      "scenarios passed, criteria met, grader scores, cost and typical reply time. It needs: " +
      "experiment runs or scenario runs. Quote the real numbers from the query result and name " +
      "the traces behind them. If a query returns no rows, say plainly that there is no data for " +
      "the dashboard period.",
  },
  {
    id: "ship-suites",
    origin: "prototype",
    question: "Do my test suites keep passing?",
    title: "Do my test suites keep passing?",
    why: "Each test suite's pass rate over time, CI runs apart from local runs.",
    questionId: "tests",
    alsoAnswers: [],
    questionType: "changed",
    personas: ["qa"],
    agentKinds: ["support-bot", "voice", "tools-agent", "generative", "vendor", "regulated"],
    requirements: [["scenarios"]],
    build: "ready",
    scope: "project",
    prompt:
      "Do my test suites keep passing? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Each suite's pass rate over time, CI runs apart from local runs. A " +
      "suite whose CI line drops needs a look. It needs: scenario runs. Quote the real numbers " +
      "from the query result and name the traces behind them. If a query returns no rows, say " +
      "plainly that there is no data for the dashboard period.",
  },
  {
    id: "ship-flaky",
    origin: "prototype",
    question: "Which tests flip between pass and fail?",
    title: "Which tests flip between pass and fail?",
    why: "The last ten runs of each scenario as passes and fails. A test that flips can't be trusted yet.",
    questionId: "testset",
    alsoAnswers: ["tests"],
    questionType: "matters",
    personas: ["qa"],
    agentKinds: ["support-bot", "rag", "voice", "tools-agent", "vendor"],
    requirements: [["scenarios"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which tests flip between pass and fail? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: The last ten runs of each test scenario as a strip of " +
      "passes and fails. A scenario that flips cannot be trusted: fix it or set it aside. It " +
      "needs: scenario runs. Quote the real numbers from the query result and name the traces " +
      "behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "ship-rollout",
    origin: "prototype",
    question: "Did my last change make my agent worse?",
    title: "Did my last change make my agent worse?",
    why: "Quality, errors, speed and cost in the 7 days after your last prompt, model or deploy change, against the same days a week before.",
    questionId: "change",
    alsoAnswers: [],
    questionType: "changed",
    personas: ["eng", "product", "prompt"],
    agentKinds: ["support-bot", "rag", "generative", "vendor", "regulated"],
    requirements: [
      ["prompts", "deploys"],
      ["evals", "outcome"],
    ],
    build: "logic",
    scope: "project",
    prompt:
      "Did my last change make my agent worse? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Up to 7 days after the last prompt, model or deploy " +
      "change, against the same weekdays a week earlier: pass rate, errors, response time and " +
      "cost. Topics are evened out, so new questions do not look like a regression. It needs: " +
      "prompt version on trace or deploy or environment tag; evaluator results or outcome event. " +
      "Quote the real numbers from the query result and name the traces behind them. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "ship-models",
    origin: "prototype",
    question: "Which model gives me the same quality for less?",
    title: "Which model gives me the same quality for less?",
    why: "For each model you tried on the same questions: how many answers passed, the cost and the speed, so you can pick the cheapest one that keeps quality.",
    questionId: "less",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["prompt", "eng"],
    agentKinds: ["voice", "extraction", "tools-agent"],
    requirements: [["experiments"]],
    build: "ready",
    scope: "project",
    prompt:
      "Which model gives me the same quality for less? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: From test runs that compared models: pass rate, " +
      "cost and slowest-5% reply time for each model or setup. Pick the cheapest one that keeps " +
      "quality. It needs: experiment runs; cost and tokens. Quote the real numbers from the " +
      "query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "cost-verdict",
    origin: "prototype",
    question: "Will I stay within my AI budget this month?",
    title: "Will I stay within my AI budget this month?",
    why: "Spend so far this month and where you will end up at this pace, against your budget.",
    questionId: "spend",
    alsoAnswers: ["outcomecost"],
    questionType: "line",
    personas: ["finance", "leader"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["budget"]],
    build: "feature",
    scope: "project",
    prompt:
      "Will I stay within my AI budget this month? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Spend so far this month (production, failed runs, " +
      "evaluations and simulations), the forecast to month end at the last 7 days' pace against " +
      "my budget, and the cost of one resolved conversation. It needs: cost and tokens; budget " +
      "on project spend. Quote the real numbers from the query result and name the traces behind " +
      "them. If a query returns no rows, say plainly that there is no data for the dashboard " +
      "period.",
  },
  {
    id: "cost-by-source",
    origin: "prototype",
    question: "How much do I spend on testing versus real users?",
    title: "How much do I spend on testing versus real users?",
    why: "Spend split into real users, evaluations and simulations.",
    questionId: "evalcost",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["finance", "qa"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [],
    build: "ready",
    scope: "project",
    prompt:
      "How much do I spend on testing versus real users? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Spend split by where it came from: production " +
      "traffic, evaluations, simulations and experiments (playground and workflows). It needs: " +
      "cost and tokens. Quote the real numbers from the query result and name the traces behind " +
      "them. If a query returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "cost-by-model",
    origin: "prototype",
    question: "Which model costs me the most?",
    title: "Which model costs me the most?",
    why: "Spend per model next to its share of requests. A model that costs more than its share is the one to swap.",
    questionId: "spend",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["finance", "eng", "prompt"],
    agentKinds: ["support-bot", "rag", "tools-agent", "generative", "vendor"],
    requirements: [["model"]],
    build: "ready",
    scope: "project",
    prompt:
      "Which model costs me the most? Answer it with LangWatchQL over the dashboard period. What " +
      "the answer shows: Spend per model, with its share of traffic. A model that costs more " +
      "than its share of traffic is the one to move off. It needs: cost and tokens; model name. " +
      "Quote the real numbers from the query result and name the traces behind them. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "cost-waste",
    origin: "prototype",
    question: "How much of my spend is wasted?",
    title: "How much of my spend is wasted?",
    why: "Money spent on failed requests, retries and loops, as a share of what you spend on real users.",
    questionId: "spend",
    alsoAnswers: ["costok"],
    questionType: "matters",
    personas: ["eng", "finance"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["steps"]],
    build: "logic",
    scope: "project",
    prompt:
      "How much of my spend is wasted? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Spend on failed runs my agent never recovered from, on retries, " +
      "and on the repeated part of loops, each counted once, as a share of production spend. Fix " +
      "the biggest line first. It needs: cost and tokens; tool and step spans. Quote the real " +
      "numbers from the query result and name the traces behind them. If a query returns no " +
      "rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "cost-by-segment",
    origin: "prototype",
    question: "Which customers or teams cost me the most?",
    title: "Which customers or teams cost me the most?",
    why: "Spend per customer, team or any label you send, top ten.",
    questionId: "acctcost",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["finance", "product"],
    agentKinds: ["generative", "vendor"],
    requirements: [["customer", "labels"]],
    build: "ready",
    scope: "project",
    prompt:
      "Which customers or teams cost me the most? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Spend per customer, team or other group I choose from " +
      "trace metadata, top ten. Calls that carry no group get their own row. It needs: cost and " +
      "tokens; customer id or labels or metadata. Quote the real numbers from the query result " +
      "and name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
  {
    id: "att-share",
    origin: "prototype",
    question: "Which customers use my agent most?",
    title: "Which customers use my agent most?",
    why: "Conversations per customer in the last 7 days, and each customer's share.",
    questionId: "howmany",
    alsoAnswers: ["used"],
    questionType: "compare",
    personas: ["product", "ops"],
    agentKinds: [
      "support-bot",
      "rag",
      "voice",
      "extraction",
      "tools-agent",
      "generative",
      "vendor",
    ],
    requirements: [["customer", "labels"]],
    build: "ready",
    scope: "project",
    prompt:
      "Which customers use my agent most? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Conversations (or documents, or calls) per customer in the last 7 " +
      "days, and each customer's share of the total. It needs: customer id or labels or " +
      "metadata. Quote the real numbers from the query result and name the traces behind them. " +
      "If a query returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "att-table",
    origin: "prototype",
    question: "How does my agent do for each of my customers?",
    title: "How does my agent do for each of my customers?",
    why: "One row per customer: volume, pass rate and its trend, and cost per conversation.",
    questionId: "finish",
    alsoAnswers: ["answers", "acctcost"],
    questionType: "compare",
    personas: ["ops", "product"],
    agentKinds: ["voice", "extraction", "generative", "vendor"],
    requirements: [["customer", "labels"], ["evals"]],
    build: "ready",
    scope: "project",
    prompt:
      "How does my agent do for each of my customers? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: One row per customer: volume, pass rate and its " +
      "trend, AI cost and cost per conversation. Each row has a read-only link I can share with " +
      "that customer. It needs: customer id or labels or metadata; evaluator results; cost and " +
      "tokens. Quote the real numbers from the query result and name the traces behind them. If " +
      "a query returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "att-change",
    origin: "prototype",
    question: "Did my last change break anything for a customer?",
    title: "Did my last change break anything for a customer?",
    why: "Each customer's pass rate in the 7 days after your last change, against the 7 days before.",
    questionId: "change",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["eng", "ops"],
    agentKinds: ["extraction", "generative", "vendor"],
    requirements: [["customer", "labels"], ["evals"], ["prompts", "deploys"]],
    build: "logic",
    scope: "project",
    prompt:
      "Did my last change break anything for a customer? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Each customer's pass rate in the 7 days after " +
      "the last prompt, model or config change, against the 7 days before. It needs: customer id " +
      "or labels or metadata; evaluator results; prompt version on trace or deploy or " +
      "environment tag. Quote the real numbers from the query result and name the traces behind " +
      "them. If a query returns no rows, say plainly that there is no data for the dashboard " +
      "period.",
  },
  {
    id: "so-verdict",
    origin: "prototype",
    question: "Can risk sign off this release?",
    title: "Can risk sign off this release?",
    why: "This week against last: what each safety check caught, what waits for review, and how far the automatic checks agree with people.",
    questionId: "change",
    alsoAnswers: ["attacked", "pii", "rules"],
    questionType: "prove",
    personas: ["risk"],
    agentKinds: [
      "support-bot",
      "rag",
      "voice",
      "extraction",
      "tools-agent",
      "generative",
      "regulated",
    ],
    requirements: [["guardrails"], ["evals"]],
    build: "logic",
    scope: "project",
    prompt:
      "Can risk sign off this release? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: This week against last week: what each safety control checked, " +
      "items flagged but not blocked, review items pending, and how well each automatic grader " +
      "agrees with human reviewers. It needs: guardrail results; evaluator results. Quote the " +
      "real numbers from the query result and name the traces behind them. If a query returns no " +
      "rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "so-rubric",
    origin: "prototype",
    question: "Does my agent pass each policy check?",
    title: "Does my agent pass each policy check?",
    why: "Pass rate per policy rule, such as accuracy, made-up facts and inappropriate content, against the minimum you set.",
    questionId: "rules",
    alsoAnswers: [],
    questionType: "line",
    personas: ["risk", "qa"],
    agentKinds: [
      "support-bot",
      "rag",
      "voice",
      "extraction",
      "tools-agent",
      "generative",
      "regulated",
    ],
    requirements: [["evals"]],
    build: "ready",
    scope: "project",
    prompt:
      "Does my agent pass each policy check? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Pass rate per policy criterion (accuracy, completeness, " +
      "made-up facts, inappropriate content), with an error margin, against the minimum I set. " +
      "It needs: evaluator results. Quote the real numbers from the query result and name the " +
      "traces behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "so-queue",
    origin: "prototype",
    question: "Is the review queue keeping up?",
    title: "Is the review queue keeping up?",
    why: "Items waiting for review, items checked, and how long a review takes.",
    questionId: "standard",
    alsoAnswers: ["rules", "judges"],
    questionType: "prove",
    personas: ["risk", "ops", "expert"],
    agentKinds: [
      "support-bot",
      "rag",
      "voice",
      "extraction",
      "tools-agent",
      "generative",
      "regulated",
    ],
    requirements: [["annotations"]],
    build: "ready",
    scope: "project",
    prompt:
      "Is the review queue keeping up? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Items flagged for review plus random checks: how many reviewers " +
      "have checked, how many wait, and how long a review takes. It needs: reviewer annotations. " +
      "Quote the real numbers from the query result and name the traces behind them. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "so-agreement",
    origin: "prototype",
    question: "Can I trust my automatic checks?",
    title: "Can I trust my automatic checks?",
    why: "How often your automatic quality checks agree with the people who reviewed the same answers. When they often disagree, the checks need fixing before you rely on them.",
    questionId: "judges",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["qa", "expert"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["evals"], ["annotations"]],
    build: "logic",
    scope: "project",
    prompt:
      "Can I trust my automatic checks? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Each week, an agreement score between each grader and human " +
      "reviewers on a random sample (0.8 or more is good). A grader whose score falls has " +
      "drifted. It needs: evaluator results; reviewer annotations. Quote the real numbers from " +
      "the query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "so-changes",
    origin: "prototype",
    question: "Who changed my agent, and when?",
    title: "Who changed my agent, and when?",
    why: "Every prompt, model, check and setting change, with who made it and when. Your audit trail.",
    questionId: "change",
    alsoAnswers: [],
    questionType: "prove",
    personas: ["risk"],
    agentKinds: [
      "support-bot",
      "rag",
      "voice",
      "extraction",
      "tools-agent",
      "generative",
      "regulated",
    ],
    requirements: [["history"]],
    build: "logic",
    scope: "project",
    prompt:
      "Who changed my agent, and when? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: A log of every prompt version, model, evaluator and setting " +
      "change, with who made it and when. The audit trail for each release. It needs: change " +
      "history in langwatch. Quote the real numbers from the query result and name the traces " +
      "behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "voice-turn-latency",
    origin: "prototype",
    question: "Which part of a reply makes my voice agent slow?",
    title: "Which part of a reply makes my voice agent slow?",
    why: "Reply time split into listening, thinking and speaking.",
    questionId: "fast",
    alsoAnswers: [],
    questionType: "why",
    personas: ["eng"],
    agentKinds: ["voice"],
    requirements: [["voice"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which part of a reply makes my voice agent slow? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Slowest-5% time per reply, split into its " +
      "stages: speech to text, thinking, and text to speech. It needs: voice stage timings. " +
      "Quote the real numbers from the query result and name the traces behind them. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "voice-task-success",
    origin: "prototype",
    question: "Do my voice agent's calls get the job done?",
    title: "Do my voice agent's calls get the job done?",
    why: "The share of calls that finished the task, per language.",
    questionId: "finish",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["ops", "product"],
    agentKinds: ["voice"],
    requirements: [["judge", "outcome"], ["labels"]],
    build: "feature",
    scope: "project",
    prompt:
      "Do my voice agent's calls get the job done? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Share of calls that an automatic check marks as task done, " +
      "per language. Calls where no task applies are left out. It needs: conversation outcome " +
      "judge or outcome event; labels or metadata. Quote the real numbers from the query result " +
      "and name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
  {
    id: "voice-call-health",
    origin: "prototype",
    question: "Which calls drop, or have my agent repeat itself?",
    title: "Which calls drop, or have my agent repeat itself?",
    why: "Dropped calls and repeated sentences per 1,000 calls.",
    questionId: "failing",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["ops", "eng"],
    agentKinds: ["voice"],
    requirements: [["voice"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which calls drop, or have my agent repeat itself? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Per 1,000 calls: calls that dropped before an " +
      "ending, and calls where my agent repeated a sentence. It needs: voice stage timings; " +
      "conversation id. Quote the real numbers from the query result and name the traces behind " +
      "them. If a query returns no rows, say plainly that there is no data for the dashboard " +
      "period.",
  },
  {
    id: "voice-cost-per-call",
    origin: "prototype",
    question: "What does one call cost, speech included?",
    title: "What does one call cost, speech included?",
    why: "Model cost per call plus speech-to-text and text-to-speech at your vendor's rate.",
    questionId: "convcost",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["finance"],
    agentKinds: ["voice"],
    requirements: [["vendor"]],
    build: "feature",
    scope: "project",
    prompt:
      "What does one call cost, speech included? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: LLM cost per call from traces, plus speech to text and " +
      "text to speech at the speech vendor's rate. It needs: cost and tokens; speech vendor " +
      "rates. Quote the real numbers from the query result and name the traces behind them. If a " +
      "query returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "rag-failure-source",
    origin: "prototype",
    question: "When my assistant is wrong, is search or the answer to blame?",
    title: "When my assistant is wrong, is search or the answer to blame?",
    why: "Failed answers split by cause: search found the wrong documents, or the answer was wrong despite good documents.",
    questionId: "grounded",
    alsoAnswers: [],
    questionType: "why",
    personas: ["eng", "expert"],
    agentKinds: ["rag"],
    requirements: [["rag"], ["judge"]],
    build: "logic",
    scope: "project",
    prompt:
      "When my assistant is wrong, is search or the answer to blame? Answer it with LangWatchQL " +
      "over the dashboard period. What the answer shows: Failed traces split by cause: the " +
      "search found wrong or no passages, or the answer was wrong although the passages were " +
      "good. Tool errors are shown apart. It needs: retrieved contexts; conversation outcome " +
      "judge. Quote the real numbers from the query result and name the traces behind them. If a " +
      "query returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "rag-empty-retrieval",
    origin: "prototype",
    question: "How often does my assistant's search find nothing?",
    title: "How often does my assistant's search find nothing?",
    why: "The share of questions per day where search returned no documents.",
    questionId: "grounded",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["eng", "expert"],
    agentKinds: ["rag"],
    requirements: [["rag"]],
    build: "ready",
    scope: "project",
    prompt:
      "How often does my assistant's search find nothing? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Share of questions per day whose search step " +
      "returned no documents. It needs: retrieved contexts. Quote the real numbers from the " +
      "query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "rag-dataset-versions",
    origin: "prototype",
    question: "Does my test set still match what users ask?",
    title: "Does my test set still match what users ask?",
    why: "Each test set version's score, and the same score weighted to what real users ask today.",
    questionId: "testset",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["qa", "expert"],
    agentKinds: ["rag"],
    requirements: [["experiments"]],
    build: "logic",
    scope: "project",
    prompt:
      "Does my test set still match what users ask? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: The correctness score of each test-set version, " +
      "and the same score reweighted to the topic mix of real traffic. A large gap means the " +
      "test set is out of date. It needs: experiment runs; topics. Quote the real numbers from " +
      "the query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "ext-field-accuracy",
    origin: "prototype",
    question: "Which fields does my agent get wrong?",
    title: "Which fields does my agent get wrong?",
    why: "The share of documents with each field right, per document type.",
    questionId: "answers",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["expert", "ops"],
    agentKinds: ["extraction"],
    requirements: [["fields"], ["labels"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which fields does my agent get wrong? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Share of documents with each field correct, per document " +
      "type, from an automatic check. It needs: per-field checks; labels or metadata. Quote the " +
      "real numbers from the query result and name the traces behind them. If a query returns no " +
      "rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "ext-precision-recall",
    origin: "prototype",
    question: "Does the new version find more fields, and get them right?",
    title: "Does the new version find more fields, and get them right?",
    why: "For your last 12 test runs: the share of extracted fields that are right, and the share of real fields found.",
    questionId: "tests",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["qa", "eng"],
    agentKinds: ["extraction"],
    requirements: [["experiments"], ["fields"]],
    build: "logic",
    scope: "project",
    prompt:
      "Does the new version find more fields, and get them right? Answer it with LangWatchQL " +
      "over the dashboard period. What the answer shows: For each of the last 12 test runs on " +
      "labelled documents: the share of extracted fields that are right, and the share of real " +
      "fields my agent found. It needs: experiment runs; per-field checks. Quote the real " +
      "numbers from the query result and name the traces behind them. If a query returns no " +
      "rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "ext-human-review",
    origin: "prototype",
    question: "How many documents go to a person?",
    title: "How many documents go to a person?",
    why: "The share of documents sent for human review per day, and the type sent most.",
    questionId: "finish",
    alsoAnswers: [],
    questionType: "changed",
    personas: ["ops"],
    agentKinds: ["extraction"],
    requirements: [["outcome"]],
    build: "ready",
    scope: "project",
    prompt:
      "How many documents go to a person? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Share of documents sent to human review per day, and the document " +
      "type sent most. It needs: outcome event. Quote the real numbers from the query result and " +
      "name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
  {
    id: "ext-cost-per-doc",
    origin: "prototype",
    question: "What does one document cost to process?",
    title: "What does one document cost to process?",
    why: "Cost per document, overall and per model, with model changes marked.",
    questionId: "convcost",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["finance", "eng"],
    agentKinds: ["extraction"],
    requirements: [["model"]],
    build: "ready",
    scope: "project",
    prompt:
      "What does one document cost to process? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Production cost per document, overall and per model, with " +
      "model changes marked. It needs: cost and tokens; model name. Quote the real numbers from " +
      "the query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "tools-error-rate",
    origin: "prototype",
    question: "Which tools fail, and does my agent recover?",
    title: "Which tools fail, and does my agent recover?",
    why: "Error rate per tool, and how many of those errors a later step fixed.",
    questionId: "tools",
    alsoAnswers: ["failing"],
    questionType: "matters",
    personas: ["eng"],
    agentKinds: ["tools-agent"],
    requirements: [["steps"], ["errors"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which tools fail, and does my agent recover? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Error rate per tool, and the share of those " +
      "errors a later step fixed. It needs: tool and step spans; error status on spans. Quote " +
      "the real numbers from the query result and name the traces behind them. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "tools-wrong-tool",
    origin: "prototype",
    question: "Does my agent pick the right tool first?",
    title: "Does my agent pick the right tool first?",
    why: "The share of tasks per day where the first tool picked was the wrong one.",
    questionId: "tools",
    alsoAnswers: [],
    questionType: "line",
    personas: ["eng", "prompt"],
    agentKinds: ["tools-agent"],
    requirements: [["steps"], ["evals"]],
    build: "logic",
    scope: "project",
    prompt:
      "Does my agent pick the right tool first? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Share of tasks per day where an automatic grader marks the " +
      "first tool chosen as wrong. It needs: tool and step spans; evaluator results. Quote the " +
      "real numbers from the query result and name the traces behind them. If a query returns no " +
      "rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "gen-acceptance",
    origin: "prototype",
    question: "Do users keep what my agent writes?",
    title: "Do users keep what my agent writes?",
    why: "Per day: the share of outputs users kept, edited, regenerated or ignored.",
    questionId: "finish",
    alsoAnswers: ["happy"],
    questionType: "happened",
    personas: ["product"],
    agentKinds: ["generative"],
    requirements: [["thumbs"]],
    build: "ready",
    scope: "project",
    prompt:
      "Do users keep what my agent writes? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Per day: the share of generated outputs that users accepted, " +
      "edited, regenerated or ignored. It needs: end-user thumbs events. Quote the real numbers " +
      "from the query result and name the traces behind them. If a query returns no rows, say " +
      "plainly that there is no data for the dashboard period.",
  },
  {
    id: "gen-dropoff",
    origin: "prototype",
    question: "Where do users drop what my agent wrote?",
    title: "Where do users drop what my agent wrote?",
    why: "How many outputs were generated, shown, used and kept, so you can see where most of them get lost.",
    questionId: "finish",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["product"],
    agentKinds: ["generative"],
    requirements: [["thumbs"], ["outcome"]],
    build: "logic",
    scope: "project",
    prompt:
      "Where do users drop what my agent wrote? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: How many outputs were generated, shown, used and kept. The " +
      "biggest drop is the step to fix. It needs: end-user thumbs events; outcome event. Quote " +
      "the real numbers from the query result and name the traces behind them. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "users",
    origin: "proposed",
    question: "How many users does my agent have, and who are the heaviest users?",
    title: "",
    why: "Active users per day and the heaviest users. The denominator for every per-user number.",
    questionId: "howmany",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["product", "leader"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [],
    build: "ready",
    scope: "project",
    prompt:
      "How many users does my agent have, and who are the heaviest users? Answer it with " +
      "LangWatchQL over the dashboard period. What the answer shows: Active users per day and " +
      "the heaviest users. The denominator for every per-user number. It needs: user id. Quote " +
      "the real numbers from the query result and name the traces behind them. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "return",
    origin: "proposed",
    question: "Do users come back to my agent?",
    title: "",
    why: "Share of users who come back the next week, by the week they started. Falling return means my agent did not help the first time.",
    questionId: "comeback",
    alsoAnswers: [],
    questionType: "changed",
    personas: ["product", "leader"],
    agentKinds: ["support-bot", "rag", "voice", "tools-agent", "generative"],
    requirements: [],
    build: "logic",
    scope: "project",
    prompt:
      "Do users come back to my agent? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Share of users who come back the next week, by the week they " +
      "started. Falling return means my agent did not help the first time. It needs: user id. " +
      "Quote the real numbers from the query result and name the traces behind them. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "cost-conv",
    origin: "proposed",
    question: "What does one conversation with my agent cost?",
    title: "",
    why: "Cost per conversation, its spread, and the most expensive conversations. The unit a business compares with the cost of a person.",
    questionId: "convcost",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["finance", "product"],
    agentKinds: ["support-bot", "rag", "voice", "tools-agent"],
    requirements: [],
    build: "ready",
    scope: "project",
    prompt:
      "What does one conversation with my agent cost? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Cost per conversation, its spread, and the most " +
      "expensive conversations. The unit a business compares with the cost of a person. It " +
      "needs: cost and tokens; conversation id. Quote the real numbers from the query result and " +
      "name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
  {
    id: "cost-outcome",
    origin: "proposed",
    question: "What does each correct outcome of my agent cost?",
    title: "",
    why: "Cost divided by successful tasks, over time. The number falls when quality rises or cost drops.",
    questionId: "outcomecost",
    alsoAnswers: [],
    questionType: "changed",
    personas: ["leader", "finance", "product"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["judge", "outcome"]],
    build: "logic",
    scope: "project",
    prompt:
      "What does each correct outcome of my agent cost? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Cost divided by successful tasks, over time. The " +
      "number falls when quality rises or cost drops. It needs: cost and tokens; conversation " +
      "outcome judge or outcome event. Quote the real numbers from the query result and name the " +
      "traces behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "work-saved",
    origin: "proposed",
    question: "How much manual work does my agent save?",
    title: "",
    why: "Successful tasks times my own value of one task. Shown only when I set that value; never in a default template.",
    questionId: "manual",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["leader", "ops"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["judge", "outcome"], ["valueset"]],
    build: "feature",
    scope: "project",
    prompt:
      "How much manual work does my agent save? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Successful tasks times my own value of one task. Shown " +
      "only when I set that value; never in a default template. It needs: conversation outcome " +
      "judge or outcome event; value settings. Quote the real numbers from the query result and " +
      "name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
  {
    id: "task-drop",
    origin: "proposed",
    question: "At which step do my agent's tasks drop off?",
    title: "",
    why: "How many tasks reach each step the customer defines (asked, answered, acted, converted).",
    questionId: "finish",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["product", "leader"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["outcome"]],
    build: "logic",
    scope: "project",
    prompt:
      "At which step do my agent's tasks drop off? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: How many tasks reach each step the customer defines " +
      "(asked, answered, acted, converted). It needs: outcome event. Quote the real numbers from " +
      "the query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "user-thumbs",
    origin: "proposed",
    question: "Which answers did users rate badly?",
    title: "",
    why: "End-user thumbs down per day and the latest rated traces, from the thumbs events the app sends.",
    questionId: "happy",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["product", "ops"],
    agentKinds: ["support-bot", "rag", "voice", "tools-agent", "generative"],
    requirements: [["thumbs"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which answers did users rate badly? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: End-user thumbs down per day and the latest rated traces, from the " +
      "thumbs events the app sends. It needs: end-user thumbs events. Quote the real numbers " +
      "from the query result and name the traces behind them. If a query returns no rows, say " +
      "plainly that there is no data for the dashboard period.",
  },
  {
    id: "grounded",
    origin: "proposed",
    question: "How often does my agent make things up?",
    title: "",
    why: "Share of answers a faithfulness check fails, per day and per topic.",
    questionId: "grounded",
    alsoAnswers: [],
    questionType: "changed",
    personas: ["eng", "expert", "qa"],
    agentKinds: ["rag", "support-bot"],
    requirements: [["evals"], ["rag"]],
    build: "ready",
    scope: "project",
    prompt:
      "How often does my agent make things up? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Share of answers a faithfulness check fails, per day and " +
      "per topic. It needs: evaluator results; retrieved contexts. Quote the real numbers from " +
      "the query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "pii",
    origin: "proposed",
    question: "Is personal data leaking through my agent?",
    title: "",
    why: "Personal data found in inputs and outputs per day, and what was blocked.",
    questionId: "pii",
    alsoAnswers: [],
    questionType: "line",
    personas: ["risk"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["guardrails", "evals"]],
    build: "ready",
    scope: "project",
    prompt:
      "Is personal data leaking through my agent? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Personal data found in inputs and outputs per day, and " +
      "what was blocked. It needs: guardrail results or evaluator results. Quote the real " +
      "numbers from the query result and name the traces behind them. If a query returns no " +
      "rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "attacks",
    origin: "proposed",
    question: "Is anyone trying to break my agent?",
    title: "",
    why: "Prompt-injection and jailbreak attempts per day, and how many got through.",
    questionId: "attacked",
    alsoAnswers: [],
    questionType: "line",
    personas: ["risk", "eng"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["guardrails", "evals"]],
    build: "ready",
    scope: "project",
    prompt:
      "Is anyone trying to break my agent? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Prompt-injection and jailbreak attempts per day, and how many got " +
      "through. It needs: guardrail results or evaluator results. Quote the real numbers from " +
      "the query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "off-scope",
    origin: "proposed",
    question: "Does my agent stay on brand and in scope?",
    title: "",
    why: "Share of answers that break a scope, tone or policy check, with examples.",
    questionId: "attacked",
    alsoAnswers: ["rules"],
    questionType: "line",
    personas: ["product", "risk"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["evals"]],
    build: "ready",
    scope: "project",
    prompt:
      "Does my agent stay on brand and in scope? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Share of answers that break a scope, tone or policy check, " +
      "with examples. It needs: evaluator results. Quote the real numbers from the query result " +
      "and name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
  {
    id: "data-health",
    origin: "proposed",
    question: "What is my agent not sending yet?",
    title: "What is my agent not sending yet?",
    why: "Each detail the dashboards need, such as model, cost, user and conversation, how often it is missing, and how to add it.",
    questionId: "arriving",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["eng"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["traces"]],
    build: "built",
    scope: "project",
    prompt:
      "What is my agent not sending yet? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Share of requests that carry each field, model name and cost over " +
      "the requests that call a model, conversation id and user id for chat agents, customer " +
      "or labels and outcome as optional extras. Each gap names what to send. It needs: traces. " +
      "Quote the real numbers from the query result and name the traces behind them. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "noise",
    origin: "proposed",
    question: "How much of my traffic is tests, not real users?",
    title: "How much of my traffic is tests, not real users?",
    why: "Traffic from the playground, evaluations, simulations and test environments, and its share of requests and cost.",
    questionId: "arriving",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["eng", "finance"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["traces"]],
    build: "built",
    scope: "project",
    prompt:
      "How much of my traffic is tests, not real users? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Traffic that clearly comes from tests, staging " +
      "and the like: playground, evaluation and simulation runs, and traces from a test, staging " +
      "or dev environment. Each source's share of traces and of cost. It needs: traces. Quote " +
      "the real numbers from the query result and name the traces behind them. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "cost-accuracy",
    origin: "proposed",
    question: "Are my cost numbers complete?",
    title: "Are my cost numbers complete?",
    why: "Requests that used a model with no known price, so their cost is missing from every total. Requests stored before 7 October 2026 count as priced.",
    questionId: "costok",
    alsoAnswers: [],
    questionType: "line",
    personas: ["finance", "eng"],
    agentKinds: ["support-bot", "rag", "voice", "extraction", "tools-agent", "generative"],
    requirements: [["model"]],
    build: "built",
    scope: "project",
    prompt:
      "Are my cost numbers complete? Answer it with LangWatchQL over the dashboard period. What " +
      "the answer shows: Traces with a model but no price, and the models with no known price. " +
      "Missing cost understates spend. Traces stored before 7 October 2026 have no unpriced " +
      "record, so they count as priced. It needs: model name. Quote the real numbers from the " +
      "query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "inventory",
    origin: "proposed",
    question: "Which agents run here, and who owns them?",
    title: "",
    why: "Every project, service and agent seen in traces, with owner and last activity.",
    questionId: "inventory",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["risk", "leader"],
    agentKinds: [],
    requirements: [["projects"]],
    build: "logic",
    scope: "org",
    prompt:
      "Which agents run here, and who owns them? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Every project, service and agent seen in traces, with " +
      "owner and last activity. It needs: several projects. Quote the real numbers from the " +
      "query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "ai-tools",
    origin: "proposed",
    question: "Which AI tools does my company use?",
    title: "Which AI tools does my company use?",
    why: "Developers and teams using each AI tool, such as Claude Code, Cursor or ChatGPT, this month.",
    questionId: "inventory",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["finance", "leader", "risk"],
    agentKinds: [],
    requirements: [["coding", "gateway"]],
    build: "logic",
    scope: "org",
    prompt:
      "Which AI tools does my company use? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Staff and teams per AI tool, from coding-agent and gateway " +
      "traffic. It needs: coding-agent traces or gateway traffic. Quote the real numbers from " +
      "the query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "seats",
    origin: "proposed",
    question: "Which AI seats bought for my staff sit unused?",
    title: "",
    why: "Seats bought minus seats assigned, per vendor pool. Counts only paid, per-person pools, as the governance cost screen does.",
    questionId: "codingcost",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["finance"],
    agentKinds: [],
    requirements: [["seats"]],
    build: "feature",
    scope: "org",
    prompt:
      "Which AI seats bought for my staff sit unused? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Seats bought minus seats assigned, per vendor " +
      "pool. Counts only paid, per-person pools, as the governance cost screen does. It needs: " +
      "seat licences in lwql. Quote the real numbers from the query result and name the traces " +
      "behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "tool-access",
    origin: "proposed",
    question: "Which tools does each of my agents use?",
    title: "",
    why: "Tools seen in each agent's traces. LangWatch sees use, not permissions.",
    questionId: "access",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["risk", "eng"],
    agentKinds: [],
    requirements: [["steps"]],
    build: "logic",
    scope: "org",
    prompt:
      "Which tools does each of my agents use? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Tools seen in each agent's traces. LangWatch sees use, not " +
      "permissions. It needs: tool and step spans. Quote the real numbers from the query result " +
      "and name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
  {
    id: "standard",
    origin: "proposed",
    question: "Is every one of my agents held to the same checks?",
    title: "",
    why: "For each project: which evaluators and scenarios run, and its pass rate against the org floor.",
    questionId: "standard",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["risk", "leader"],
    agentKinds: [],
    requirements: [["evals"], ["projects"]],
    build: "logic",
    scope: "org",
    prompt:
      "Is every one of my agents held to the same checks? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: For each project: which evaluators and scenarios " +
      "run, and its pass rate against the org floor. It needs: evaluator results; several " +
      "projects. Quote the real numbers from the query result and name the traces behind them. " +
      "If a query returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "org-spend",
    origin: "proposed",
    question: "What does each team and app spend?",
    title: "",
    why: "Spend per project and team, month to date.",
    questionId: "orgspend",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["finance", "leader"],
    agentKinds: [],
    requirements: [["projects"]],
    build: "ready",
    scope: "org",
    prompt:
      "What does each team and app spend? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Spend per project and team, month to date. It needs: cost and " +
      "tokens; several projects. Quote the real numbers from the query result and name the " +
      "traces behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "lw-value",
    origin: "proposed",
    question: "What has LangWatch caught for me?",
    title: "",
    why: "Failures found, regressions blocked before release and alerts sent this month.",
    questionId: "value",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["leader", "finance"],
    agentKinds: [],
    requirements: [["traces"], ["evals"]],
    build: "logic",
    scope: "org",
    prompt:
      "What has LangWatch caught for me? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Failures found, regressions blocked before release and alerts sent " +
      "this month. It needs: traces; evaluator results. Quote the real numbers from the query " +
      "result and name the traces behind them. If a query returns no rows, say plainly that " +
      "there is no data for the dashboard period.",
  },
  {
    id: "me-burn-summary",
    origin: "prototype",
    question: "Where did my tokens go this month?",
    title: "Where did my tokens go this month?",
    why: "What your coding agents cost so far, whether this week runs ahead of a normal one, and how often you hit a rate limit.",
    questionId: "spend",
    alsoAnswers: [],
    questionType: "changed",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "Where did my tokens go this month? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Spend and tokens for the period, this week's pace, and how often I " +
      "hit rate limits. It needs: coding-agent traces. Quote the real numbers from the query " +
      "result and name the traces behind them. If a query returns no rows, say plainly that " +
      "there is no data for the dashboard period.",
  },
  {
    id: "me-expensive-sessions",
    origin: "prototype",
    question: "Which sessions cost the most?",
    title: "Which sessions cost the most?",
    why: "Your sessions ranked by cost, and what made the top ones expensive.",
    questionId: "spend",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "ready",
    scope: "project",
    prompt:
      "Which sessions cost the most? Answer it with LangWatchQL over the dashboard period. What " +
      "the answer shows: My most expensive sessions, ranked. Each one opens its session. It " +
      "needs: coding-agent traces. Quote the real numbers from the query result and name the " +
      "traces behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "me-by-pr",
    origin: "prototype",
    question: "Which pull requests did my tokens go to?",
    title: "Which pull requests did my tokens go to?",
    why: "Tokens and cost per pull request, so you can see which piece of work ate the budget.",
    questionId: "spend",
    alsoAnswers: ["outcomecost"],
    questionType: "matters",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"], ["prs"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which pull requests did my tokens go to? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Tokens and cost per pull request. It needs: coding-agent " +
      "traces; github pull requests. Quote the real numbers from the query result and name the " +
      "traces behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "me-spend-by-model",
    origin: "prototype",
    question: "Which models do I spend on?",
    title: "Which models do I spend on?",
    why: "Your coding-agent cost per model, per day. A pricey model doing easy work is the first thing to switch.",
    questionId: "spend",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "ready",
    scope: "project",
    prompt:
      "Which models do I spend on? Answer it with LangWatchQL over the dashboard period. What " +
      "the answer shows: My coding-agent cost per model, per day. It needs: coding-agent traces. " +
      "Quote the real numbers from the query result and name the traces behind them. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "me-pace",
    origin: "prototype",
    question: "Am I spending faster than usual?",
    title: "Am I spending faster than usual?",
    why: "Money spent day by day against your typical week, with a dot on each day you hit a rate limit.",
    questionId: "spend",
    alsoAnswers: [],
    questionType: "changed",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "Am I spending faster than usual? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Money spent day by day against my typical week. Dots mark rate " +
      "limits. It needs: coding-agent traces. Quote the real numbers from the query result and " +
      "name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
  {
    id: "me-cache-gauge",
    origin: "prototype",
    question: "Is my cache working?",
    title: "Is my cache working?",
    why: "The share of input the model reads from cache instead of processing again. Below 60%, caching is broken and every call costs more.",
    questionId: "spend",
    alsoAnswers: [],
    questionType: "line",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "Is my cache working? Answer it with LangWatchQL over the dashboard period. What the " +
      "answer shows: The share of input the model reads from cache instead of processing again. " +
      "Higher is cheaper; under 60% means caching is not working. It needs: coding-agent traces. " +
      "Quote the real numbers from the query result and name the traces behind them. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "me-tool-round-trips",
    origin: "prototype",
    question: "Which tool calls flooded my context?",
    title: "Which tool calls flooded my context?",
    why: "The tool calls that returned the biggest results, where filtering or paging the output saves you the most money.",
    questionId: "spend",
    alsoAnswers: ["tools"],
    questionType: "matters",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which tool calls flooded my context? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: The tool calls that returned the most tokens. Filtering or " +
      "paging these saves the most. It needs: coding-agent traces. Quote the real numbers from " +
      "the query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "me-main-vs-sub",
    origin: "prototype",
    question: "How do my tokens split between main chat and subagents?",
    title: "How do my tokens split between main chat and subagents?",
    why: "Tokens per day in the main conversation against subagents.",
    questionId: "spend",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "ready",
    scope: "project",
    prompt:
      "How do my tokens split between main chat and subagents? Answer it with LangWatchQL over " +
      "the dashboard period. What the answer shows: Tokens per day, main conversation against " +
      "subagents. It needs: coding-agent traces. Quote the real numbers from the query result " +
      "and name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
  {
    id: "me-leaks",
    origin: "prototype",
    question: "Where am I wasting money?",
    title: "Where am I wasting money?",
    why: "Wasted spend in your sessions, such as a broken cache or a tool that floods the context, each with what to change.",
    questionId: "spend",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "Where am I wasting money? Answer it with LangWatchQL over the dashboard period. What the " +
      "answer shows: Six fixed rules that find wasted spend in my session data, each with what " +
      "to do about it. It needs: coding-agent traces. Quote the real numbers from the query " +
      "result and name the traces behind them. If a query returns no rows, say plainly that " +
      "there is no data for the dashboard period.",
  },
  {
    id: "me-value-per-token",
    origin: "prototype",
    question: "What does one merged pull request cost?",
    title: "What does one merged pull request cost?",
    why: "Coding-agent cost per merged pull request, and whether it is going up or down.",
    questionId: "outcomecost",
    alsoAnswers: [],
    questionType: "changed",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"], ["prs"]],
    build: "logic",
    scope: "project",
    prompt:
      "What does one merged pull request cost? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Coding-agent cost per merged pull request, and the trend. " +
      "It needs: coding-agent traces; github pull requests. Quote the real numbers from the " +
      "query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "me-shipping-calendar",
    origin: "prototype",
    question: "How many pull requests did I merge each day?",
    title: "How many pull requests did I merge each day?",
    why: "Merged pull requests per day, as a calendar.",
    questionId: "used",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["prs"]],
    build: "ready",
    scope: "project",
    prompt:
      "How many pull requests did I merge each day? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Merged pull requests per day, as a calendar. It " +
      "needs: github pull requests. Quote the real numbers from the query result and name the " +
      "traces behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "me-cost-per-pr",
    origin: "prototype",
    question: "Which pull requests cost far more than usual?",
    title: "Which pull requests cost far more than usual?",
    why: "Cost of each merged pull request; with the ones far above your usual picked out.",
    questionId: "outcomecost",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"], ["prs"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which pull requests cost far more than usual? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Coding-agent cost of each merged pull request; " +
      "the ones far above my median stand out. It needs: coding-agent traces; github pull " +
      "requests. Quote the real numbers from the query result and name the traces behind them. " +
      "If a query returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "me-babysit",
    origin: "prototype",
    question: "What does a pull request cost from open to merge?",
    title: "What does a pull request cost from open to merge?",
    why: "Cost before the pull request opened against cost after, from CI retries and review fixes.",
    questionId: "outcomecost",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"], ["prs"]],
    build: "logic",
    scope: "project",
    prompt:
      "What does a pull request cost from open to merge? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Cost before the pull request opened against cost " +
      "after it opened. It needs: coding-agent traces; github pull requests. Quote the real " +
      "numbers from the query result and name the traces behind them. If a query returns no " +
      "rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "me-pr-leaderboard",
    origin: "prototype",
    question: "Which of my pull requests cost the most?",
    title: "Which of my pull requests cost the most?",
    why: "Your pull requests ranked by coding-agent cost.",
    questionId: "outcomecost",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"], ["prs"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which of my pull requests cost the most? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: My pull requests ranked by coding-agent cost. It needs: " +
      "coding-agent traces; github pull requests. Quote the real numbers from the query result " +
      "and name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
  {
    id: "me-output-vs-spend",
    origin: "prototype",
    question: "Is my output keeping up with my spend?",
    title: "Is my output keeping up with my spend?",
    why: "Merged pull requests and commits per week next to what you spent.",
    questionId: "outcomecost",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"], ["prs"]],
    build: "logic",
    scope: "project",
    prompt:
      "Is my output keeping up with my spend? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Merged pull requests and commits next to what I spent, per " +
      "week. It needs: coding-agent traces; github pull requests. Quote the real numbers from " +
      "the query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "me-gantt",
    origin: "prototype",
    question: "What did my sessions do through the day?",
    title: "What did my sessions do through the day?",
    why: "Your sessions across the day: working, or waiting for your reply.",
    questionId: "fast",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "What did my sessions do through the day? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: My sessions across the day: working, or waiting for my " +
      "reply. It needs: coding-agent traces. Quote the real numbers from the query result and " +
      "name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
  {
    id: "me-waiting-on-you",
    origin: "prototype",
    question: "Which sessions waited longest for me?",
    title: "Which sessions waited longest for me?",
    why: "The sessions that sat longest this week waiting for your reply.",
    questionId: "fast",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which sessions waited longest for me? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: The sessions that sat longest waiting for me this week. It " +
      "needs: coding-agent traces. Quote the real numbers from the query result and name the " +
      "traces behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "me-reply-latency",
    origin: "prototype",
    question: "How long do my agents wait for my reply?",
    title: "How long do my agents wait for my reply?",
    why: "Time from the end of an agent's turn to your reply.",
    questionId: "fast",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "How long do my agents wait for my reply? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Time from the end of an agent's turn to my reply. It " +
      "needs: coding-agent traces. Quote the real numbers from the query result and name the " +
      "traces behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "me-parallel-heatmap",
    origin: "prototype",
    question: "How many sessions do I run at once?",
    title: "How many sessions do I run at once?",
    why: "Sessions running at the same time, by hour and day.",
    questionId: "used",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "How many sessions do I run at once? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Sessions running at the same time, by hour and day. It needs: " +
      "coding-agent traces. Quote the real numbers from the query result and name the traces " +
      "behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "me-overnight",
    origin: "prototype",
    question: "What did my coding agents do overnight?",
    title: "What did my coding agents do overnight?",
    why: "What ran between midnight and 07:00 this week.",
    questionId: "used",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "What did my coding agents do overnight? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: What ran between midnight and 07:00 this week. It needs: " +
      "coding-agent traces. Quote the real numbers from the query result and name the traces " +
      "behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "me-active-waiting",
    origin: "prototype",
    question: "How much time do my agents work, and how much do they wait for me?",
    title: "How much time do my agents work, and how much do they wait for me?",
    why: "Working time against waiting time, per day.",
    questionId: "fast",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "How much time do my agents work, and how much do they wait for me? Answer it with " +
      "LangWatchQL over the dashboard period. What the answer shows: Working time against " +
      "waiting time, per day. It needs: coding-agent traces. Quote the real numbers from the " +
      "query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "me-context-per-call",
    origin: "prototype",
    question: "How big does my context get?",
    title: "How big does my context get?",
    why: "Context size per model call, each day, against the 250k to 450k band.",
    questionId: "spend",
    alsoAnswers: [],
    questionType: "line",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "How big does my context get? Answer it with LangWatchQL over the dashboard period. What " +
      "the answer shows: Context size per model call, each day, against the 250k to 450k band. " +
      "It needs: coding-agent traces. Quote the real numbers from the query result and name the " +
      "traces behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "me-compaction",
    origin: "prototype",
    question: "Do I compact at the right time?",
    title: "Do I compact at the right time?",
    why: "Each compaction at the context size where it happened, against the cheapest point.",
    questionId: "spend",
    alsoAnswers: [],
    questionType: "line",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "Do I compact at the right time? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Each compaction at the context size where it happened, against the " +
      "best point. It needs: coding-agent traces. Quote the real numbers from the query result " +
      "and name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
  {
    id: "me-call-cost",
    origin: "prototype",
    question: "What does one call cost as context grows?",
    title: "What does one call cost as context grows?",
    why: "Average cost of one model call at each context size, which is why compacting earlier makes every call cheaper.",
    questionId: "spend",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "What does one call cost as context grows? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Average price of one model call by context size. " +
      "Compacting earlier makes calls cheaper. It needs: coding-agent traces. Quote the real " +
      "numbers from the query result and name the traces behind them. If a query returns no " +
      "rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "me-oversized-context",
    origin: "prototype",
    question: "How much do I pay for oversized context?",
    title: "How much do I pay for oversized context?",
    why: "Money spent on context above 450k tokens, where every call gets expensive.",
    questionId: "spend",
    alsoAnswers: [],
    questionType: "line",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "How much do I pay for oversized context? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Money spent on context above the 450k line. It needs: " +
      "coding-agent traces. Quote the real numbers from the query result and name the traces " +
      "behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "me-subagent-context",
    origin: "prototype",
    question: "How much context does each subagent type carry?",
    title: "How much context does each subagent type carry?",
    why: "Typical context per subagent type. A fork carries the whole conversation, a small explorer starts small.",
    questionId: "spend",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "How much context does each subagent type carry? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Median context per subagent type. A fork carries " +
      "the whole conversation; a small explorer starts small. It needs: coding-agent traces. " +
      "Quote the real numbers from the query result and name the traces behind them. If a query " +
      "returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "me-steps",
    origin: "prototype",
    question: "How many model calls does a task take?",
    title: "How many model calls does a task take?",
    why: "Model calls per task, and the tasks that ran far longer than the rest.",
    questionId: "tools",
    alsoAnswers: ["depth"],
    questionType: "happened",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "How many model calls does a task take? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Model calls per task, and the long tail. It needs: " +
      "coding-agent traces. Quote the real numbers from the query result and name the traces " +
      "behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "me-harness-effect",
    origin: "prototype",
    question: "Do my skills and MCPs make pull requests cheaper?",
    title: "Do my skills and MCPs make pull requests cheaper?",
    why: "Tokens per merged pull request in sessions that used each skill, MCP or CLI, against sessions that did not. It shows a link, it does not prove a cause.",
    questionId: "change",
    alsoAnswers: ["tools"],
    questionType: "compare",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"], ["prs"]],
    build: "logic",
    scope: "project",
    prompt:
      "Do my skills and MCPs make pull requests cheaper? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: Tokens per merged pull request in sessions that " +
      "used each one, against sessions that did not. A correlation, not a controlled test. It " +
      "needs: coding-agent traces; github pull requests. Quote the real numbers from the query " +
      "result and name the traces behind them. If a query returns no rows, say plainly that " +
      "there is no data for the dashboard period.",
  },
  {
    id: "me-tool-mix",
    origin: "prototype",
    question: "Which tools eat the most tokens?",
    title: "Which tools eat the most tokens?",
    why: "Tokens returned by each tool, with shell commands grouped by command.",
    questionId: "tools",
    alsoAnswers: [],
    questionType: "matters",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which tools eat the most tokens? Answer it with LangWatchQL over the dashboard period. " +
      "What the answer shows: Result tokens by tool, with shell commands grouped by command. It " +
      "needs: coding-agent traces. Quote the real numbers from the query result and name the " +
      "traces behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "me-clis-mcps",
    origin: "prototype",
    question: "Which CLIs and MCPs do I use?",
    title: "Which CLIs and MCPs do I use?",
    why: "Calls per CLI and MCP server, and the trend.",
    questionId: "tools",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which CLIs and MCPs do I use? Answer it with LangWatchQL over the dashboard period. What " +
      "the answer shows: Calls per CLI and MCP server, and the trend. It needs: coding-agent " +
      "traces. Quote the real numbers from the query result and name the traces behind them. If " +
      "a query returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "me-harness-changes",
    origin: "prototype",
    question: "What changed in my setup since last week?",
    title: "What changed in my setup since last week?",
    why: "Skills, MCPs and CLIs added, removed or changed.",
    questionId: "change",
    alsoAnswers: [],
    questionType: "changed",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "What changed in my setup since last week? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Skills, MCPs and CLIs added, removed or changed. It needs: " +
      "coding-agent traces. Quote the real numbers from the query result and name the traces " +
      "behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "me-skills-in-use",
    origin: "prototype",
    question: "Which skills actually run?",
    title: "Which skills actually run?",
    why: "How often each skill runs and what it steers.",
    questionId: "tools",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which skills actually run? Answer it with LangWatchQL over the dashboard period. What the " +
      "answer shows: How often each skill runs, and what it steers. It needs: coding-agent " +
      "traces. Quote the real numbers from the query result and name the traces behind them. If " +
      "a query returns no rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "me-harness-speed",
    origin: "prototype",
    question: "Which tools slow my coding agent down?",
    title: "Which tools slow my coding agent down?",
    why: "Time per tool call, and the total time each tool took this week.",
    questionId: "fast",
    alsoAnswers: ["tools"],
    questionType: "matters",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which tools slow my coding agent down? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Time per tool call, and total time per tool this week. It " +
      "needs: coding-agent traces. Quote the real numbers from the query result and name the " +
      "traces behind them. If a query returns no rows, say plainly that there is no data for the " +
      "dashboard period.",
  },
  {
    id: "me-dead-weight",
    origin: "prototype",
    question: "Which MCPs load every time but rarely run?",
    title: "Which MCPs load every time but rarely run?",
    why: "MCP servers whose tools load into every session, with how rarely you call them. Remove them to start every session smaller.",
    questionId: "tools",
    alsoAnswers: ["spend"],
    questionType: "matters",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "Which MCPs load every time but rarely run? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: Servers whose schemas load into every session, with how " +
      "rarely they are used. It needs: coding-agent traces. Quote the real numbers from the " +
      "query result and name the traces behind them. If a query returns no rows, say plainly " +
      "that there is no data for the dashboard period.",
  },
  {
    id: "me-sub-vs-api",
    origin: "prototype",
    question: "Is my seat cheaper than paying per token?",
    title: "Is my seat cheaper than paying per token?",
    why: "Your last 30 days at pay-per-token list rates, against what your seat costs.",
    questionId: "less",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "Is my seat cheaper than paying per token? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: My last 30 days priced at API list rates, against my seat " +
      "price. It needs: coding-agent traces. Quote the real numbers from the query result and " +
      "name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
  {
    id: "me-provider-replay",
    origin: "prototype",
    question: "What would last month cost with other vendors?",
    title: "What would last month cost with other vendors?",
    why: "Your last 30 days at other vendors' rates, comparing cost only, without quality.",
    questionId: "less",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "What would last month cost with other vendors? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: My last 30 days priced on other vendors' rate " +
      "cards. Prices only, no quality adjustment. It needs: coding-agent traces. Quote the real " +
      "numbers from the query result and name the traces behind them. If a query returns no " +
      "rows, say plainly that there is no data for the dashboard period.",
  },
  {
    id: "me-context-fit",
    origin: "prototype",
    question: "Would my calls fit in other vendors' context limits?",
    title: "Would my calls fit in other vendors' context limits?",
    why: "The share of your calls bigger than each vendor's context limit.",
    questionId: "less",
    alsoAnswers: [],
    questionType: "compare",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "Would my calls fit in other vendors' context limits? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: The share of my calls above each vendor's " +
      "context limit. It needs: coding-agent traces. Quote the real numbers from the query " +
      "result and name the traces behind them. If a query returns no rows, say plainly that " +
      "there is no data for the dashboard period.",
  },
  {
    id: "me-cache-sensitivity",
    origin: "prototype",
    question: "How would my bill change with a better cache rate?",
    title: "How would my bill change with a better cache rate?",
    why: "Your bill at different cache hit rates, per vendor.",
    questionId: "less",
    alsoAnswers: ["spend"],
    questionType: "compare",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "How would my bill change with a better cache rate? Answer it with LangWatchQL over the " +
      "dashboard period. What the answer shows: My bill at different cache hit rates, per " +
      "vendor. It needs: coding-agent traces. Quote the real numbers from the query result and " +
      "name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
  {
    id: "me-peak-hours",
    origin: "prototype",
    question: "Do my tokens land in peak-price hours?",
    title: "Do my tokens land in peak-price hours?",
    why: "When in the day your tokens happen, against vendors' peak-price windows.",
    questionId: "less",
    alsoAnswers: [],
    questionType: "happened",
    personas: ["eng"],
    agentKinds: ["coding"],
    requirements: [["coding"]],
    build: "logic",
    scope: "project",
    prompt:
      "Do my tokens land in peak-price hours? Answer it with LangWatchQL over the dashboard " +
      "period. What the answer shows: When my tokens happen in the day, against vendors' peak " +
      "windows. It needs: coding-agent traces. Quote the real numbers from the query result and " +
      "name the traces behind them. If a query returns no rows, say plainly that there is no " +
      "data for the dashboard period.",
  },
];
