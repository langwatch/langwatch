/**
 * Every template: one dashboard per job, in the order the gallery lists them, most needed first.
 * A template adapts to the agent kind: its per-kind widget lists are variants, never listed.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import {
  type AgentKind,
  type CatalogueScope,
  type Persona,
  type Trunk,
} from "./catalogue-labels.ts";
import { CATALOGUE_WIDGETS } from "./catalogue-widgets.ts";
import { DATA_REQUIREMENTS } from "./data-requirements.ts";

/** Where a template is offered: a project's agent, the whole organisation, or coding agents. */
export type TemplateArea = "llmops" | "org" | "coding";

export interface CatalogueTemplate {
  readonly id: string;
  readonly name: string;
  readonly job: string;
  /** Names the template had before, so a board made under one still reads as added. */
  readonly formerNames: readonly string[];
  readonly personas: readonly Persona[];
  readonly trunk: Trunk;
  readonly origin: "prototype" | "library";
  readonly scope: CatalogueScope;
  readonly isDefault: boolean;
  /** The widgets, top to bottom. */
  readonly widgets: readonly string[];
  /** Other widgets for some agent kinds; the template made for that kind shows them instead. */
  readonly byAgentKind: Readonly<Partial<Record<AgentKind, readonly string[]>>>;
  /** The agent kinds whose projects get this board made for them; empty means gallery only. */
  readonly preloadFor: readonly AgentKind[];
  /**
   * The one agent kind the template is made for. It only helps find the template: the board
   * it makes covers the whole project.
   */
  readonly focusKind?: AgentKind;
  /**
   * What Langy is asked when a board is made from the template: a short written report, then
   * what the board needs that the project has not set up yet, with an offer to help.
   */
  readonly reportPrompt: string;
}

/** A template as written; its report prompt and focus kind are derived. */
type AuthoredTemplate = Omit<CatalogueTemplate, "focusKind" | "reportPrompt">;

const AUTHORED_TEMPLATES: readonly AuthoredTemplate[] = [
  {
    id: "cockpit",
    name: "My agent at a glance",
    job: "Whether your agent succeeds, how much use your agent gets, errors and speed right now against a normal day, and the one problem to fix first this week.",
    formerNames: ["Agent health"],
    personas: ["leader", "product", "ops", "eng"],
    trunk: "Grow",
    origin: "prototype",
    scope: "project",
    isDefault: true,
    widgets: ["ck-kpis", "ck-status", "ck-attention", "ck-top-ask", "ck-trend"],
    byAgentKind: {
      voice: ["ck-kpis", "ck-status", "ck-attention", "ck-top-ask", "voice-task-success"],
      generative: ["ck-kpis", "ck-status", "ck-attention", "ck-top-ask", "gen-acceptance"],
    },
    preloadFor: [
      "support-bot",
      "rag",
      "vendor",
      "voice",
      "extraction",
      "regulated",
      "tools-agent",
      "generative",
    ],
  },
  {
    id: "answers",
    name: "Answer quality",
    job: "Which answers fail your automatic quality checks, where the agent gives up or makes things up, and the conversations a person should read next.",
    formerNames: [],
    personas: ["product", "qa", "expert"],
    trunk: "Protect",
    origin: "prototype",
    scope: "project",
    isDefault: false,
    widgets: ["ans-outcomes", "ans-evaluators", "ans-idk", "so-agreement", "ans-review"],
    byAgentKind: {
      rag: [
        "rag-failure-source",
        "rag-empty-retrieval",
        "ans-idk",
        "ans-evaluators",
        "so-agreement",
        "ans-review",
      ],
      voice: ["ans-outcomes", "ans-evaluators", "ans-idk", "so-agreement"],
      extraction: ["ans-outcomes", "ans-evaluators", "so-agreement", "ans-review"],
      "tools-agent": ["ans-outcomes", "ans-evaluators", "so-agreement", "ans-review"],
      generative: ["ans-outcomes", "ans-evaluators", "so-agreement", "ans-review"],
    },
    preloadFor: [
      "support-bot",
      "rag",
      "vendor",
      "voice",
      "extraction",
      "regulated",
      "tools-agent",
      "generative",
    ],
  },
  {
    id: "change",
    name: "Did my last change break anything?",
    job: "Quality, errors and token use after your last prompt, model or deploy change, against the week before. Keep the change or roll back.",
    formerNames: ["Did my change help?"],
    personas: ["eng", "prompt", "product"],
    trunk: "Protect",
    origin: "library",
    scope: "project",
    isDefault: false,
    widgets: [
      "ship-rollout",
      "ans-outcomes",
      "up-errors",
      "token-drift",
      "fd-quality",
      "so-changes",
    ],
    byAgentKind: {},
    preloadFor: [],
  },
  {
    id: "costs",
    name: "Where the money goes",
    job: "Spend by model, what testing costs next to real use, money lost to failed requests and loops, and whether you stay within budget this month.",
    formerNames: ["Running costs"],
    personas: ["finance", "eng", "leader"],
    trunk: "Profit",
    origin: "prototype",
    scope: "project",
    isDefault: false,
    widgets: ["cost-verdict", "cost-by-source", "cost-by-model", "cost-waste"],
    byAgentKind: {
      voice: ["cost-verdict", "voice-cost-per-call", "cost-by-source", "cost-waste"],
      extraction: ["cost-verdict", "ext-cost-per-doc", "cost-by-source", "cost-waste"],
    },
    preloadFor: [
      "support-bot",
      "rag",
      "vendor",
      "voice",
      "extraction",
      "tools-agent",
      "generative",
    ],
  },
  {
    id: "models",
    name: "Same quality, cheaper model",
    job: "Quality, cost and speed of each model you tried on the same questions, side by side, so you can pick the cheapest one that holds up.",
    formerNames: ["Compare models"],
    personas: ["prompt", "eng"],
    trunk: "Profit",
    origin: "library",
    scope: "project",
    isDefault: false,
    widgets: ["ship-models", "ship-compare", "cost-by-model", "slowest-models", "top-models"],
    byAgentKind: {},
    preloadFor: [],
  },
  {
    id: "release",
    name: "Ready to ship?",
    job: "The new version's test results against the current one, the tests that flip between pass and fail, and how the last rollout went. Ship or hold the new version.",
    formerNames: ["Release check"],
    personas: ["qa", "eng", "product"],
    trunk: "Protect",
    origin: "prototype",
    scope: "project",
    isDefault: false,
    widgets: ["ship-verdict", "ship-suites", "ship-flaky", "ship-compare", "ship-rollout"],
    byAgentKind: {
      rag: ["ship-verdict", "rag-dataset-versions", "ship-flaky", "ship-compare", "ship-rollout"],
      voice: ["ship-verdict", "ship-suites", "ship-flaky", "ship-models"],
      extraction: ["ship-verdict", "ext-precision-recall", "ship-models", "ship-compare"],
      regulated: ["ship-verdict", "ship-suites", "ship-compare", "ship-rollout"],
      "tools-agent": ["ship-verdict", "ship-suites", "ship-flaky", "ship-compare", "ship-models"],
      generative: ["ship-verdict", "ship-suites", "ship-compare", "ship-rollout"],
    },
    preloadFor: [
      "support-bot",
      "rag",
      "vendor",
      "voice",
      "extraction",
      "regulated",
      "tools-agent",
      "generative",
    ],
  },
  {
    id: "breaks",
    name: "Errors and failures",
    job: "The top errors, the step or tool that fails, where the agent goes in circles, and the failed requests to open first.",
    formerNames: ["Where my agent breaks"],
    personas: ["eng", "ops"],
    trunk: "Protect",
    origin: "prototype",
    scope: "project",
    isDefault: false,
    widgets: ["up-errors", "up-where-fails", "up-step-latency", "up-loops", "up-failing-traces"],
    byAgentKind: {
      "tools-agent": [
        "tools-error-rate",
        "tools-wrong-tool",
        "up-loops",
        "up-step-latency",
        "up-failing-traces",
      ],
    },
    preloadFor: [
      "support-bot",
      "rag",
      "vendor",
      "voice",
      "extraction",
      "regulated",
      "tools-agent",
      "generative",
    ],
  },
  {
    id: "safety",
    name: "Safety and privacy",
    job: "Attacks on your agent, personal data in questions and answers, and answers that go off brand, with what got through.",
    formerNames: [],
    personas: ["risk", "eng"],
    trunk: "Protect",
    origin: "library",
    scope: "project",
    isDefault: false,
    widgets: ["attacks", "pii", "off-scope", "so-rubric", "so-changes"],
    byAgentKind: {},
    preloadFor: [],
  },
  {
    id: "evals",
    name: "Can I trust my automatic checks?",
    job: "How often your automatic checks agree with people, how much traffic they cover and which tests flip. Fix a check before you trust its score.",
    formerNames: ["Can I trust my evals?"],
    personas: ["qa", "expert"],
    trunk: "Protect",
    origin: "library",
    scope: "project",
    isDefault: false,
    widgets: [
      "so-agreement",
      "evaluation-coverage",
      "lowest-passing-evaluators",
      "ship-flaky",
      "rag-dataset-versions",
    ],
    byAgentKind: {},
    preloadFor: [],
  },
  {
    id: "signoff",
    name: "Evidence for the risk team",
    job: "What each safety check caught this week against last, what waits for review, and who changed the agent. Hand the board to your risk team when a release needs sign-off.",
    formerNames: ["Risk sign-off"],
    personas: ["risk"],
    trunk: "Protect",
    origin: "prototype",
    scope: "project",
    isDefault: false,
    widgets: ["so-verdict", "so-rubric", "so-queue", "so-changes"],
    byAgentKind: {},
    preloadFor: ["regulated"],
  },
  {
    id: "tools",
    name: "Tool calls",
    job: "Which tools fail, whether the agent picks the right one first, and where the agent repeats itself and wastes money.",
    formerNames: ["Tool use"],
    personas: ["eng", "prompt"],
    trunk: "Protect",
    origin: "library",
    scope: "project",
    isDefault: false,
    widgets: ["tools-error-rate", "tools-wrong-tool", "up-loops", "up-step-latency", "cost-waste"],
    byAgentKind: {},
    preloadFor: [],
  },
  {
    id: "asks",
    name: "What users ask for",
    job: "The most common topics, the ones growing, and what users want that your agent can't do yet. Use the list to pick what to build next.",
    formerNames: ["What users ask"],
    personas: ["product", "expert"],
    trunk: "Grow",
    origin: "prototype",
    scope: "project",
    isDefault: false,
    widgets: ["ask-cannot", "ask-rising", "ans-topics", "ask-again"],
    byAgentKind: {},
    preloadFor: [
      "support-bot",
      "rag",
      "vendor",
      "voice",
      "extraction",
      "regulated",
      "tools-agent",
      "generative",
    ],
  },
  {
    id: "happy",
    name: "Are users happy?",
    job: "Satisfaction against the period before, answers users rated badly, how often they ask twice, and whether they come back.",
    formerNames: [],
    personas: ["product", "ops"],
    trunk: "Grow",
    origin: "library",
    scope: "project",
    isDefault: false,
    widgets: ["satisfaction-shift", "user-thumbs", "ask-again", "return"],
    byAgentKind: {},
    preloadFor: [],
  },
  {
    id: "unit-cost",
    name: "What each result costs",
    job: "Cost per request without an error, per customer and, once conversations are scored, per resolved conversation. Compare those with what the same work costs done by a person.",
    formerNames: ["Cost per result"],
    personas: ["leader", "finance", "product"],
    trunk: "Profit",
    origin: "library",
    scope: "project",
    isDefault: false,
    widgets: ["cost-outcome", "cost-conv", "fd-cost-efficiency", "cost-by-segment"],
    byAgentKind: {},
    preloadFor: [],
  },
  {
    id: "customers",
    name: "By customer",
    job: "Usage, quality and cost for each of your customers, and which ones your last change hurt.",
    formerNames: [],
    personas: ["ops", "product", "finance"],
    trunk: "Grow",
    origin: "prototype",
    scope: "project",
    isDefault: false,
    widgets: ["att-share", "cost-by-segment", "att-table", "att-change"],
    byAgentKind: {},
    preloadFor: ["vendor"],
  },
  {
    id: "speed",
    name: "Why is my agent slow?",
    job: "How fast your agent answers, the slow days, and which step or model holds up the reply.",
    formerNames: ["Make my agent faster"],
    personas: ["eng"],
    trunk: "Grow",
    origin: "library",
    scope: "project",
    isDefault: false,
    widgets: [
      "latency-slo",
      "latency-spread",
      "up-step-latency",
      "slowest-models",
      "fd-throughput",
    ],
    byAgentKind: {
      voice: [
        "latency-slo",
        "latency-spread",
        "up-step-latency",
        "slowest-models",
        "voice-turn-latency",
      ],
    },
    preloadFor: [],
  },
  {
    id: "adoption",
    name: "Usage and users",
    job: "Requests per day, active users, who comes back and what they talk about. See whether use is growing.",
    formerNames: ["Usage and adoption"],
    personas: ["product", "leader"],
    trunk: "Grow",
    origin: "library",
    scope: "project",
    isDefault: false,
    widgets: ["traffic", "users", "return", "topics"],
    byAgentKind: {},
    preloadFor: [],
  },
  {
    id: "data",
    name: "Fix missing data",
    job: "What your app does not send yet, such as model, cost, user or conversation, requests with no known price, and how much traffic is tests. Each gap comes with its fix.",
    formerNames: ["Can I trust my numbers?"],
    personas: ["eng"],
    trunk: "Trust",
    origin: "library",
    scope: "project",
    isDefault: false,
    widgets: ["data-health", "cost-accuracy", "noise", "evaluation-coverage"],
    byAgentKind: {},
    preloadFor: [],
  },
  {
    id: "calls",
    name: "Voice call quality",
    job: "Where reply time goes (listening, thinking, speaking), dropped calls and repeats, and calls to listen to.",
    formerNames: ["Call quality"],
    personas: ["ops", "eng", "qa"],
    trunk: "Protect",
    origin: "prototype",
    scope: "project",
    isDefault: false,
    widgets: ["voice-turn-latency", "voice-call-health", "att-table", "ans-review"],
    byAgentKind: {},
    preloadFor: ["voice"],
  },
  {
    id: "fields",
    name: "Document field accuracy",
    job: "Which fields and document types your agent gets wrong, and how many documents go to a person.",
    formerNames: ["Field accuracy"],
    personas: ["expert", "ops", "qa"],
    trunk: "Protect",
    origin: "prototype",
    scope: "project",
    isDefault: false,
    widgets: ["ext-field-accuracy", "ext-human-review", "att-table", "att-change"],
    byAgentKind: {},
    preloadFor: ["extraction"],
  },
  {
    id: "outputs",
    name: "Do users keep what my agent writes?",
    job: "How much of what your agent writes users keep, edit or throw away, and where they drop the text.",
    formerNames: ["Outputs users keep"],
    personas: ["product"],
    trunk: "Grow",
    origin: "prototype",
    scope: "project",
    isDefault: false,
    widgets: ["gen-dropoff", "att-table", "att-change", "cost-by-segment"],
    byAgentKind: {},
    preloadFor: ["generative"],
  },
  {
    id: "org",
    name: "Your company's AI at a glance",
    job: "Every agent and its owner, which AI tools people use, what each team spends, and which agents skip the company's checks.",
    formerNames: ["LangWatch at a glance"],
    personas: ["leader", "risk", "finance"],
    trunk: "Profit",
    origin: "library",
    scope: "org",
    isDefault: false,
    widgets: ["inventory", "ai-tools", "org-spend", "fd-gateway", "standard", "fd-coding-agents"],
    byAgentKind: {},
    preloadFor: [],
  },
  {
    id: "me-tokens",
    name: "Where did my tokens go?",
    job: "What your coding agents cost this period, by session, pull request and model, how much comes from cache, and where money is wasted.",
    formerNames: ["My Token Burn Rate"],
    personas: ["eng"],
    trunk: "Profit",
    origin: "prototype",
    scope: "project",
    isDefault: false,
    widgets: [
      "me-burn-summary",
      "me-expensive-sessions",
      "me-by-pr",
      "me-spend-by-model",
      "me-pace",
      "me-cache-gauge",
      "me-tool-round-trips",
      "me-main-vs-sub",
      "me-leaks",
    ],
    byAgentKind: {},
    preloadFor: ["coding"],
  },
  {
    id: "me-shipped",
    name: "What my pull requests cost",
    job: "Cost of each merged pull request, the ones far above your usual, and whether output keeps up with spend.",
    formerNames: ["What have I shipped"],
    personas: ["eng"],
    trunk: "Profit",
    origin: "prototype",
    scope: "project",
    isDefault: false,
    widgets: [
      "me-value-per-token",
      "me-shipping-calendar",
      "me-cost-per-pr",
      "me-babysit",
      "me-pr-leaderboard",
      "me-output-vs-spend",
    ],
    byAgentKind: {},
    preloadFor: ["coding"],
  },
  {
    id: "me-harness",
    name: "Are my skills and MCPs paying off?",
    job: "Which skills, MCPs and CLIs you use, whether sessions with them cost less per pull request, and which ones load every time but rarely run.",
    formerNames: ["My harness"],
    personas: ["eng"],
    trunk: "Grow",
    origin: "prototype",
    scope: "project",
    isDefault: false,
    widgets: [
      "me-harness-effect",
      "me-tool-mix",
      "me-clis-mcps",
      "me-harness-changes",
      "me-skills-in-use",
      "me-harness-speed",
      "me-dead-weight",
    ],
    byAgentKind: {},
    preloadFor: ["coding"],
  },
  {
    id: "me-context",
    name: "Am I carrying too much context?",
    job: "How big your context gets, when you compact and what oversized context costs. Compact earlier and every call gets cheaper.",
    formerNames: ["Context health"],
    personas: ["eng"],
    trunk: "Profit",
    origin: "prototype",
    scope: "project",
    isDefault: false,
    widgets: [
      "me-context-per-call",
      "me-compaction",
      "me-call-cost",
      "me-oversized-context",
      "me-subagent-context",
      "me-steps",
    ],
    byAgentKind: {},
    preloadFor: ["coding"],
  },
  {
    id: "me-market",
    name: "What would this cost elsewhere?",
    job: "Your last 30 days at other vendors' rates and at pay-per-token rates, against your seat. Cost only, quality is not compared.",
    formerNames: ["The market"],
    personas: ["eng"],
    trunk: "Profit",
    origin: "prototype",
    scope: "project",
    isDefault: false,
    widgets: [
      "me-sub-vs-api",
      "me-provider-replay",
      "me-context-fit",
      "me-cache-sensitivity",
      "me-peak-hours",
    ],
    byAgentKind: {},
    preloadFor: ["coding"],
  },
  {
    id: "me-speed",
    name: "My day with coding agents",
    job: "What your sessions did through the day, how long they waited for you, and what ran overnight.",
    formerNames: ["Building speed"],
    personas: ["eng"],
    trunk: "Grow",
    origin: "prototype",
    scope: "project",
    isDefault: false,
    widgets: [
      "me-gantt",
      "me-waiting-on-you",
      "me-reply-latency",
      "me-parallel-heatmap",
      "me-overnight",
      "me-active-waiting",
    ],
    byAgentKind: {},
    preloadFor: ["coding"],
  },
];

const QUESTIONS = new Map(CATALOGUE_WIDGETS.map(({ id, question }) => [id, question] as const));

/** The report Langy is asked for: the board's job, then each widget's question in order. */
function reportPromptFor({
  name,
  job,
  widgets,
}: Pick<CatalogueTemplate, "name" | "job" | "widgets">): string {
  const questions = widgets.map((id, index) => `(${index + 1}) ${QUESTIONS.get(id) ?? id}`);
  return [
    `Write a short report on my "${name}" dashboard for the dashboard period. ${job}`,
    "For each of these questions, answer in one or two sentences with the real numbers from",
    `LangWatchQL: ${questions.join(" ")} Then name the one thing that most needs attention,`,
    "and why. If a question has no data for the period, say so rather than guessing.",
    setupCheckFor(widgets),
  ].join(" ");
}

/** A kind variant's id: its template's, then the agent kind, so each stays stable. */
export function focusTemplateId({ baseId, kind }: { baseId: string; kind: AgentKind }): string {
  return `${baseId}__${kind}`;
}

/** The template as the gallery lists it, made for the one agent kind it is preloaded for. */
function catalogueTemplate(template: AuthoredTemplate): CatalogueTemplate {
  const [onlyKind, ...otherKinds] = template.preloadFor;
  return {
    ...template,
    ...(onlyKind && otherKinds.length === 0 ? { focusKind: onlyKind } : {}),
    reportPrompt: reportPromptFor(template),
  };
}

/** How the separate focus templates named their kind ("Release check: voice focus"). */
const FORMER_FOCUS_LABELS: Readonly<Record<AgentKind, string>> = {
  "support-bot": "support bot",
  rag: "RAG",
  vendor: "agent platform",
  voice: "voice",
  extraction: "extraction",
  regulated: "regulated",
  "tools-agent": "tools agent",
  generative: "generative",
  coding: "coding",
};

/**
 * The template adapted to an agent kind: its widgets for that kind under the template's own
 * name, with an id of its own; the template itself when it has no widgets for that kind. A
 * board made from the kind's former focus template still counts as this variant.
 */
export function templateForKind({
  template,
  kind,
}: {
  template: CatalogueTemplate;
  kind: AgentKind;
}): CatalogueTemplate {
  const widgets = template.byAgentKind[kind];
  if (!widgets) return template;
  return {
    ...template,
    id: focusTemplateId({ baseId: template.id, kind }),
    isDefault: false,
    widgets,
    preloadFor: template.preloadFor.includes(kind) ? [kind] : [],
    focusKind: kind,
    reportPrompt: reportPromptFor({ ...template, widgets }),
    formerNames: [
      ...template.formerNames,
      ...[template.name, ...template.formerNames].map(
        (name) => `${name}: ${FORMER_FOCUS_LABELS[kind]} focus`,
      ),
    ],
  };
}

/** Where a template is offered. */
export function templateArea(
  template: Pick<CatalogueTemplate, "scope" | "preloadFor">,
): TemplateArea {
  if (template.scope === "org") return "org";
  return template.preloadFor.includes("coding") ? "coding" : "llmops";
}

const REQUIREMENTS = new Map(DATA_REQUIREMENTS.map((need) => [need.key, need] as const));
const WIDGET_NEEDS = new Map(CATALOGUE_WIDGETS.map(({ id, requirements }) => [id, requirements]));
const WIDGET_TITLES = new Map(CATALOGUE_WIDGETS.map(({ id, title }) => [id, title] as const));

/** What a member can send or turn on to meet one requirement, sorted; none if traces do. */
function settableNames(alternatives: readonly string[]): string[] {
  if (alternatives.includes("traces")) return [];
  return alternatives
    .flatMap((key) => {
      const need = REQUIREMENTS.get(key);
      return need && need.kind !== "feature" ? [need.name] : [];
    })
    .toSorted();
}

/**
 * What the board's widgets need that a member can send or turn on, each one's alternatives
 * joined by "or". A need already implied by a narrower one is dropped, as is one met by plain
 * traces or by something LangWatch itself has still to build: none is the member's to set up.
 */
export function templateSetupNeeds(widgets: readonly string[]): string[] {
  const needs = widgets.flatMap((id) =>
    (WIDGET_NEEDS.get(id) ?? []).flatMap((alternatives) => {
      const settable = settableNames(alternatives);
      return settable.length > 0 ? [settable] : [];
    }),
  );
  const kept: string[][] = [];
  for (const need of needs.toSorted((a, b) => a.length - b.length)) {
    if (!kept.some((narrower) => isWithin({ narrower, need }))) kept.push(need);
  }
  return kept.map((need) => need.join(" or "));
}

/** A widget of the board and the data it waits for, as a sentence names it. */
export interface WidgetGap {
  readonly widget: string;
  readonly gap: string;
}

/** The widgets that wait for data the member can send or turn on, each with its needs. */
export function templateWidgetGaps(widgets: readonly string[]): WidgetGap[] {
  return widgets.flatMap((id) => {
    const needs = (WIDGET_NEEDS.get(id) ?? [])
      .map((alternatives) => settableNames(alternatives).join(" or "))
      .filter(Boolean);
    return needs.length > 0
      ? [{ widget: WIDGET_TITLES.get(id) ?? id, gap: needs.join(" and ") }]
      : [];
  });
}

/** Whether meeting `narrower` already meets `need`: each of its alternatives is one of need's. */
const isWithin = ({ narrower, need }: { narrower: readonly string[]; need: readonly string[] }) =>
  narrower.every((name) => need.includes(name));

/** The report's last ask: find what the board needs that is not set up yet, and offer help. */
function setupCheckFor(widgets: readonly string[]): string {
  const needs = templateSetupNeeds(widgets);
  const gaps = templateWidgetGaps(widgets);
  const waiting =
    gaps.length > 0
      ? ` These widgets wait for data: ${gaps.map(({ widget, gap }) => `"${widget}" needs ${gap}`).join("; ")}.`
      : "";
  const listed = needs.length > 0 ? ` It needs: ${needs.join("; ")}.${waiting}` : "";
  return [
    `Then check what this dashboard needs that my project has not set up yet.${listed}`,
    "Also look for fields its queries read that my traces lack, such as cost, user id or",
    "evaluator results, and integrations I have not connected. Say plainly what is missing,",
    "and offer to help me set up each piece.",
  ].join(" ");
}

/** Every template, one per job, most needed first: the project area, then org, then coding. */
export const CATALOGUE_TEMPLATES: readonly CatalogueTemplate[] =
  AUTHORED_TEMPLATES.map(catalogueTemplate);

/** Each template adapted to each agent kind it has its own widgets for, in template order. */
export const TEMPLATE_VARIANTS: readonly CatalogueTemplate[] = CATALOGUE_TEMPLATES.flatMap(
  (template) =>
    (Object.keys(template.byAgentKind) as AgentKind[]).map((kind) =>
      templateForKind({ template, kind }),
    ),
);

/** One area's templates, in gallery order. */
export function templatesInArea({ area }: { area: TemplateArea }): readonly CatalogueTemplate[] {
  return CATALOGUE_TEMPLATES.filter((template) => templateArea(template) === area);
}
