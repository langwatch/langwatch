/**
 * Domain-capability registry (task #12 / #27).
 *
 * Langy's worker streams every CLI/MCP tool call into the assistant turn as an
 * AI-SDK tool part (`tool-<name>` / `dynamic-tool`). This module is the pure,
 * JSX-free mapping from a tool NAME to the bespoke card that should render it —
 * keyed off the real `langwatch-mcp-server` tool names (grounded against
 * `mcp-server/src/create-mcp-server.ts`).
 *
 * Governing rule — propose-then-apply:
 *   - READ tools (search/get/list, analytics, run results) render their result
 *     inline with NO Apply. The deep-link chip is the only affordance.
 *   - WRITE tools that the backend STAGES as a proposal ride the existing
 *     ProposalCard path (`langyProposal: true` output) with Apply / Discard;
 *     that path is untouched here. A write tool that has already EXECUTED (a
 *     bare MCP result) renders as a "created"/"updated" card with an
 *     "Open in <surface>" link — the applied half of the lifecycle.
 *   - DESTRUCTIVE tools that the backend stages ride ProposalCard's red,
 *     confirm-gated variant; an already-executed delete renders as a quiet
 *     "removed" card here.
 * Only a tool name that is not a LangWatch CLI call returns null and falls
 * through to the existing raw fallback in LangyToolActivity — the docs/schema
 * helpers (`fetch_langwatch_docs`, `fetch_scenario_docs`, `discover_schema`)
 * render as clean activity lines there. Every `langwatch.<resource>.<verb>`
 * call has a card, cataloged or not.
 *
 * TRANSPORT: Langy calls the `langwatch` CLI, so a live tool call arrives as
 * `langwatch.<resource>.<verb>` — rewritten server-side by the CLI envelope out
 * of the `bash` call opencode actually made. `resolveCliCapability` (below)
 * resolves EVERY such name to a card: the capability catalog
 * (`capabilityCatalog.ts`) binds the view (surface, noun, body widget) for the
 * resources it lists, and anything it has never heard of — a command the
 * backend shipped before this UI did — degrades to a humanised card on the
 * neutral `platform` surface with no deep link. WHICH card / verb tone comes
 * from the shared `@langwatch/langy` contract, so the panel and the CLI
 * share one grammar. Only a name that is not a CLI call at all (a raw `bash`)
 * falls through to the raw view. The older MCP transport (`platform_*` /
 * `search_traces`) has been retired.
 */

import {
  type MeasuredCardKind,
  CLI_COLLECTION_VERBS,
  type CliResultDigest,
  cardKindFor,
  cliVerbTone,
} from "@langwatch/langy";
import {
  type CliCommand,
  featureForCliCommand,
  parseCliToolName,
} from "~/shared/langy/featureMap";
import {
  CAPABILITY_CATALOG,
  type CapabilityBodyWidget,
  type CapabilityCatalogEntry,
  type CapabilityIconName,
  type CapabilitySurface,
} from "./capabilityCatalog";

/** Visual tone of the shared capability-card shell. */
export type CapabilityTone = "read" | "created" | "updated" | "removed";

export interface CapabilityDescriptor {
  /**
   * Which bespoke renderer draws the card. The vocabulary is the shared CLI
   * contract's `MeasuredCardKind` (`@langwatch/langy`), rendered by
   * {@link LangyCapabilityRenderer}. A `traces` kind is a trace SEARCH (the
   * sample card), `trace` a single get.
   *
   * `cardKindFor` seeds this from the command's name; when the call carries a
   * result envelope, the card stamped there wins (see {@link withDecidedCard}).
   */
  render: MeasuredCardKind;
  tone: CapabilityTone;
  surface: CapabilitySurface;
  /** Mono overline label, e.g. "Traces", "New evaluator", "Delete dashboard". */
  overline: string;
  /** The decoded `langwatch <resource> <verb>` this call was. */
  command: CliCommand;
  /** Which body widget `LangyDeclarativeCard` draws the result with. */
  body: CapabilityBodyWidget;
  /** The resource in customer words, both numbers. */
  noun: { singular: string; plural: string };
  /** Overline icon override, when the catalog names one. */
  icon?: CapabilityIconName;
}

/** Props every bespoke capability card receives from the renderer. */
export interface CapabilityCardInput {
  descriptor: CapabilityDescriptor;
  /** The tool call's input arguments (ids, filters, the drafted resource). */
  input: unknown;
  /** The tool call's settled output (the result to render). */
  output: unknown;
  /**
   * The result digest — the reference (ids, query, counts) the card hydrates
   * fresh data from. Null for non-CLI calls and turns recorded before digests
   * existed; the card then falls back to parsing `output`.
   */
  digest?: CliResultDigest | null;
  /** Current project slug, for building deep links. */
  projectSlug?: string | null;
}

/** Human label for the "Open in <surface>" deep-link chip. */
export const SURFACE_LABEL: Record<CapabilitySurface, string> = {
  traces: "Traces",
  analytics: "Analytics",
  experiments: "Experiments",
  evaluations: "Online Evaluations",
  evaluators: "Evaluators",
  datasets: "Datasets",
  prompts: "Prompts",
  dashboards: "Dashboards",
  simulations: "Simulations",
  scenarios: "Scenarios",
  agents: "Agents",
  automations: "Automations",
  workflows: "Workflows",
  annotations: "Annotations",
  secrets: "Secrets",
  projects: "Projects",
  apiKeys: "API keys",
  modelProviders: "Model providers",
  gateway: "AI Gateway",
  platform: "LangWatch",
};

type SurfaceRouteConfig = {
  path: string;
  deepLink?: false;
  resourceHref?: (base: string, resourceId: string) => string;
};

const nestedResourceHref = (base: string, resourceId: string) =>
  `${base}/${encodeURIComponent(resourceId)}`;

const SURFACE_ROUTE_CONFIG: Record<CapabilitySurface, SurfaceRouteConfig> = {
  traces: { path: "messages", resourceHref: nestedResourceHref },
  analytics: { path: "analytics" },
  experiments: { path: "experiments", resourceHref: nestedResourceHref },
  evaluations: {
    path: "online-evaluations",
    resourceHref: (base, resourceId) =>
      `${base}?drawer.open=onlineEvaluation&drawer.monitorId=${encodeURIComponent(
        resourceId,
      )}`,
  },
  evaluators: {
    path: "evaluators",
    // `evaluatorEditor` is the drawer that actually exists (drawerRegistry.ts);
    // an earlier cut deep-linked `evaluatorViewer`, which no drawer answers to,
    // so "open the evaluator" landed on the list with nothing open.
    resourceHref: (base, resourceId) =>
      `${base}?drawer.open=evaluatorEditor&drawer.evaluatorId=${encodeURIComponent(
        resourceId,
      )}`,
  },
  datasets: { path: "datasets", resourceHref: nestedResourceHref },
  prompts: { path: "prompts" },
  // The dashboard VIEWER, and the specific dashboard when we know which one.
  // This pointed at "analytics/custom" — the empty graph builder — so every
  // "Open in Dashboards" landed on a blank form with no dashboard in it. The
  // REST layer already builds the correct form (`/analytics/reports?dashboard=`).
  dashboards: {
    path: "analytics/reports",
    resourceHref: (base, resourceId) => `${base}?dashboard=${resourceId}`,
  },
  simulations: { path: "simulations" },
  // A scenario lives in the scenario LIBRARY, and its own page is that library
  // with the scenario open — the same URL the scenarios API hands out as
  // `platformUrl`. The Simulations index is the run history, where a scenario
  // that was just written does not appear at all.
  scenarios: {
    path: "simulations/scenarios",
    resourceHref: (base, resourceId) =>
      `${base}?drawer.open=scenarioEditor&drawer.scenarioId=${encodeURIComponent(
        resourceId,
      )}`,
  },
  agents: { path: "agents" },
  automations: { path: "automations" },
  workflows: { path: "workflows" },
  annotations: { path: "annotations" },
  secrets: { path: "settings", deepLink: false },
  projects: { path: "settings/projects", deepLink: false },
  apiKeys: { path: "settings/authentication", deepLink: false },
  modelProviders: { path: "settings/model-providers", deepLink: false },
  gateway: { path: "settings", deepLink: false },
  platform: { path: "settings", deepLink: false },
};

/** Project-relative base path for each surface's index page. */
export const SURFACE_PATH = Object.fromEntries(
  Object.entries(SURFACE_ROUTE_CONFIG).map(([surface, config]) => [
    surface,
    config.path,
  ]),
) as Record<CapabilitySurface, string>;

/**
 * Build a project-scoped deep link to a surface, optionally targeting one
 * resource. Returns null without a project slug (or for a no-deep-link surface)
 * so callers hide the chip rather than link to a broken path.
 */
export function buildSurfaceHref({
  surface,
  projectSlug,
  resourceId,
}: {
  surface: CapabilitySurface;
  projectSlug?: string | null;
  resourceId?: string | null;
}): string | null {
  if (!projectSlug) return null;
  const config = SURFACE_ROUTE_CONFIG[surface];
  if (config.deepLink === false) return null;
  const base = `/${projectSlug}/${config.path}`;
  if (resourceId && config.resourceHref) {
    return config.resourceHref(base, resourceId);
  }
  return base;
}

/**
 * Deep link to ONE resource, or null when the surface has no per-resource
 * page. Unlike {@link buildSurfaceHref} this never falls back to the index —
 * it is for row-level links, where five rows all pointing at the same index
 * page would be noise pretending to be navigation.
 */
export function buildResourceHref({
  surface,
  projectSlug,
  resourceId,
}: {
  surface: CapabilitySurface;
  projectSlug?: string | null;
  resourceId?: string | null;
}): string | null {
  if (!resourceId || !SURFACE_ROUTE_CONFIG[surface].resourceHref) return null;
  return buildSurfaceHref({ surface, projectSlug, resourceId });
}

/**
 * How a CLI verb READS, in both tenses. `past` titles a SETTLED write card ("New
 * evaluator", "Delete trigger"); `present` titles a RUNNING one ("Creating
 * evaluator"). Keeping the two tenses in ONE row is the point: the two switch
 * statements this replaced could word the same verb inconsistently, and did.
 * A read verb has no past-tense label — a read card is titled by its surface,
 * not its verb — so its `past` is empty.
 *
 * The verb's TONE (read / create / update / remove) is the shared contract's to
 * decide (`cliVerbTone` in `@langwatch/langy`); it classifies verbs for the
 * whole card catalogue and stays the single source of that truth, so it is
 * deliberately not duplicated here.
 */
const VERB_WORDING: Record<string, { past: string; present: string }> = {
  search: { past: "", present: "Searching" },
  query: { past: "", present: "Searching" },
  list: { past: "", present: "Listing" },
  versions: { past: "", present: "Listing" },
  "list-runs": { past: "", present: "Listing" },
  records: { past: "", present: "Listing" },
  get: { past: "", present: "Loading" },
  show: { past: "", present: "Loading" },
  view: { past: "", present: "Loading" },
  status: { past: "", present: "Checking" },
  health: { past: "", present: "Checking" },
  results: { past: "", present: "Loading" },
  tail: { past: "", present: "Loading" },
  export: { past: "", present: "Exporting" },
  download: { past: "", present: "Downloading" },
  create: { past: "New", present: "Creating" },
  init: { past: "New", present: "Creating" },
  add: { past: "Add to", present: "Adding to" },
  upload: { past: "Upload to", present: "Uploading to" },
  update: { past: "Update", present: "Updating" },
  set: { past: "Set", present: "Updating" },
  unset: { past: "Reset", present: "Updating" },
  rotate: { past: "Rotate", present: "Rotating" },
  rename: { past: "Rename", present: "Updating" },
  assign: { past: "Assign", present: "Updating" },
  restore: { past: "Restore", present: "Restoring" },
  sync: { past: "Sync", present: "Syncing" },
  push: { past: "Push", present: "Pushing" },
  pull: { past: "Pull", present: "Pulling" },
  duplicate: { past: "Duplicate", present: "Duplicating" },
  delete: { past: "Delete", present: "Deleting" },
  remove: { past: "Delete", present: "Deleting" },
  archive: { past: "Delete", present: "Deleting" },
  revoke: { past: "Delete", present: "Deleting" },
  run: { past: "Run", present: "Running" },
};

/** `create` → "New", `delete`/`archive`/`revoke` → "Delete", etc. */
function verbLabel(verb: string): string {
  return VERB_WORDING[verb]?.past ?? "";
}

/**
 * Wording for a resource the catalog has never heard of — the version-skew
 * fallback. The command's own resource word is the only truth available, so it
 * is humanised as-is: `virtual-keys` → "virtual keys". Plural is the naive
 * `+s` unless the word already ends in one.
 */
function humanizeResource(resource: string): {
  singular: string;
  plural: string;
} {
  const singular = resource.replace(/[_-]/g, " ").trim();
  const plural = singular.endsWith("s") ? singular : `${singular}s`;
  return { singular, plural };
}

/** Sentence-case a wording fragment for the overline. */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A resolved CLI call: the card to draw, the surface it opens, its verb tone. */
export interface CliCapability {
  command: CliCommand;
  surface: CapabilitySurface;
  render: MeasuredCardKind;
  tone: CapabilityTone;
  /** Which body widget `LangyDeclarativeCard` draws the result with. */
  body: CapabilityBodyWidget;
  /** The resource in customer words, both numbers. */
  noun: { singular: string; plural: string };
  /** Overline icon override, when the catalog names one. */
  icon?: CapabilityIconName;
}

/**
 * The platform surface each mapped feature deep-links to, keyed by feature id.
 * The capability catalog is the primary surface binding now; this map only
 * ENRICHES the fallback path — when the catalog has never heard of a resource
 * but the feature map lists its command, the feature's surface still gives the
 * card a home instead of the neutral `platform` one.
 *
 * WHICH card, and the verb's tone, are NOT here: those are CLI grammar, resolved
 * once in `@langwatch/langy` (`cardKindFor`, `cliVerbTone`) and shared with
 * the CLI itself. This module owns only the view binding layered on top of them,
 * so the panel and the CLI can never disagree about what a command produced.
 */
export const SURFACE_BY_FEATURE: Record<string, CapabilitySurface> = {
  "observability.tracing": "traces",
  "observability.analytics": "analytics",
  "observability.annotations": "annotations",
  "evaluations.experiments": "experiments",
  "evaluations.online-evaluation": "evaluations",
  "agent-simulations.scenarios": "scenarios",
  "agent-simulations.runs": "simulations",
  "agent-simulations.suites": "simulations",
  "prompt-management.prompts": "prompts",
  "library.agents": "agents",
  "library.workflows": "workflows",
  "library.evaluators": "evaluators",
  "library.datasets": "datasets",
  dashboards: "dashboards",
  triggers: "automations",
  "settings.projects": "projects",
  "settings.api-keys": "apiKeys",
  "settings.model-providers": "modelProviders",
  "settings.secrets": "secrets",
};

/**
 * The body widget a card kind implies when the catalog names none: a
 * collection reads as rows, a single resource as facts, a run as figures, a
 * prompt diff as a diff, and a settled write as a sentence.
 */
function derivedBodyWidget({
  render,
  verb,
}: {
  render: MeasuredCardKind;
  verb: string;
}): CapabilityBodyWidget {
  switch (render) {
    case "traces":
    case "dataset":
      return "rows";
    case "trace":
    case "scenario":
      return "facts";
    case "metrics":
    case "evalRun":
    case "spend":
      return "stats";
    // The plot IS the body — there is no stats/rows/facts widget that says
    // anything a chart does not say better.
    case "timeseries":
      return "chart";
    case "evaluatorConfig":
      return "facts";
    case "dashboard":
      return "rows";
    // ONE run reads as facts (the live card overrides rendering anyway); a
    // SET of runs — a listing or a launched batch — reads as rows.
    case "simulationRun":
      return "facts";
    case "simulationSetRun":
      return "rows";
    case "promptDiff":
      return "diff";
    case "resourceCreated":
    case "resourceUpdated":
    case "resourceRemoved":
      return "text";
    case "resourceRead":
      return CLI_COLLECTION_VERBS.has(verb) ? "rows" : "facts";
  }
}

/** The catalog's widget for a call, or the kind-derived default. */
function bodyWidgetFor({
  entry,
  render,
  verb,
  tone,
}: {
  entry: CapabilityCatalogEntry | undefined;
  render: MeasuredCardKind;
  verb: string;
  tone: CapabilityTone;
}): CapabilityBodyWidget {
  return (
    entry?.body?.byVerb?.[verb] ??
    entry?.body?.byTone?.[tone] ??
    entry?.body?.default ??
    derivedBodyWidget({ render, verb })
  );
}

/**
 * Resolve a CLI tool name (`langwatch.<resource>.<verb>`) to its card, surface,
 * wording and tone. Null ONLY when the name is not a LangWatch CLI call at all
 * (a raw `bash`, an arbitrary shell command) — those fall through to the raw
 * activity view, which is where they belong.
 *
 * A well-formed `langwatch.*` name ALWAYS resolves:
 *   1. The catalog knows the resource → its surface, noun and body widget.
 *   2. The catalog doesn't, but the feature map lists the command → the
 *      feature's surface enriches the card; wording is humanised.
 *   3. Nobody has heard of it (the backend shipped a command this UI predates)
 *      → the neutral `platform` surface, humanised wording, no deep link.
 * The card kind and tone come from the shared contract in every branch, and
 * `cardKindFor` already lands an unknown resource on the generic read card —
 * so version skew degrades to a plainer card, never to a wall of output.
 */
export function resolveCliCapability(rawName: string): CliCapability | null {
  const command = parseCliToolName(rawName);
  if (!command) return null;

  const render = cardKindFor(command);
  const tone = cliVerbTone(command.verb);

  const entry = (CAPABILITY_CATALOG as Record<string, CapabilityCatalogEntry>)[
    command.resource
  ];
  const body = bodyWidgetFor({ entry, render, verb: command.verb, tone });

  if (entry) {
    return {
      command,
      surface: entry.surface,
      render,
      tone,
      body,
      noun: entry.noun,
      ...(entry.icon ? { icon: entry.icon } : {}),
    };
  }

  const feature = featureForCliCommand(command);
  const surface = (feature && SURFACE_BY_FEATURE[feature.id]) ?? "platform";
  return {
    command,
    surface,
    render,
    tone,
    body,
    noun: humanizeResource(command.resource),
  };
}

/**
 * Re-seat a descriptor on the card the RESULT was stamped with.
 *
 * `cardKindFor` answers from the command's NAME, which is a PRIOR. The card on
 * the envelope is the DECISION — made once at the command boundary, where the
 * payload was in hand, and carried from there to the event log, the live edge
 * and this panel (ADR-059 §1/§3). When the two differ it is because the payload
 * earned a richer card than its name could give it, which is the only thing
 * promotion ever produces. So the decision wins, and the body widget is
 * re-derived for the card that is actually being drawn.
 *
 * Without this the panel re-decided from the name and discarded anything that
 * disagreed — so a promotion, whose defining property is that it disagrees,
 * could only ever make a card vanish.
 */
export function withDecidedCard({
  descriptor,
  card,
}: {
  descriptor: CapabilityDescriptor;
  card: MeasuredCardKind;
}): CapabilityDescriptor {
  if (card === descriptor.render) return descriptor;

  const entry = (CAPABILITY_CATALOG as Record<string, CapabilityCatalogEntry>)[
    descriptor.command.resource
  ];
  return {
    ...descriptor,
    render: card,
    body: bodyWidgetFor({
      entry,
      render: card,
      verb: descriptor.command.verb,
      tone: descriptor.tone,
    }),
  };
}

/**
 * Word a CLI capability. The CLI's verb grammar is resolved in the shared
 * contract; how it READS is decided here: a collection read is titled by what
 * it lists ("Traces", "Virtual keys"), a single read by its resource
 * ("trace"), a write by what it did ("New evaluator"). The noun comes from the
 * catalog when it has one, and from the command's own words otherwise.
 */
function cliOverline({ command, tone, noun }: CliCapability): string {
  if (tone !== "read") {
    return `${verbLabel(command.verb) || command.verb} ${noun.singular}`;
  }
  if (command.verb === "run") return `Run ${noun.singular}`;
  if (CLI_COLLECTION_VERBS.has(command.verb)) return capitalize(noun.plural);
  return noun.singular;
}

/**
 * `search` → "Searching", `create` → "Creating". The present-tense twin of
 * {@link verbLabel}, read off the same {@link VERB_WORDING} row so the two
 * tenses can never drift.
 */
function progressVerb(verb: string): string {
  return VERB_WORDING[verb]?.present ?? "Working on";
}

/** A capability call that is still in flight, worded for its in-progress card. */
export interface CapabilityProgress {
  surface: CapabilitySurface;
  /** Mono overline — the surface being worked in, e.g. "Analytics". */
  overline: string;
  /** Present-tense headline, e.g. "Searching traces", "Creating evaluator". */
  headline: string;
}

/**
 * Word a RUNNING capability call, or null when the name maps to no card.
 *
 * The settled card says what came back; this says what is happening, named
 * after the thing it is happening to — "Analytics · searching traces", not
 * "Coding". Tone is deliberately NOT carried: a create that hasn't finished is
 * not yet a "created" (green, ticked) card, so the in-progress shell always
 * renders in the neutral read tone.
 */
export function resolveCapabilityProgress(
  rawName: string,
): CapabilityProgress | null {
  const cli = resolveCliCapability(rawName);
  if (!cli) return null;
  const noun = CLI_COLLECTION_VERBS.has(cli.command.verb)
    ? cli.noun.plural
    : cli.noun.singular;
  return {
    surface: cli.surface,
    overline: capitalize(cli.noun.plural),
    headline: `${progressVerb(cli.command.verb)} ${noun}`,
  };
}

/**
 * Resolve a CLI tool name (`langwatch.<resource>.<verb>`) to the card that
 * should render it, or null to fall through to the raw-JSON view.
 * `resolveCliCapability` decides the structure (gate + shared contract);
 * `cliOverline` words it.
 */
export function resolveCapability(
  rawName: string,
): CapabilityDescriptor | null {
  const cli = resolveCliCapability(rawName);
  if (!cli) return null;

  return {
    render: cli.render,
    tone: cli.tone,
    surface: cli.surface,
    overline: cliOverline(cli),
    command: cli.command,
    body: cli.body,
    noun: cli.noun,
    ...(cli.icon ? { icon: cli.icon } : {}),
  };
}

/**
 * Pull readable text out of a tool's `output`, which may be a plain string, an
 * MCP `{ content: [{ type, text }] }` envelope, a `{ text }` object, or an
 * arbitrary structured value. Falls back to pretty JSON so a card always has
 * something to show without leaking `[object Object]`.
 */
export function extractToolText(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  if (typeof output === "object") {
    const obj = output as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    const content = obj.content;
    if (Array.isArray(content)) {
      const parts = content
        .map((c) =>
          c &&
          typeof c === "object" &&
          typeof (c as { text?: unknown }).text === "string"
            ? (c as { text: string }).text
            : "",
        )
        .filter(Boolean);
      if (parts.length > 0) return parts.join("\n");
    }
    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return "";
    }
  }
  return String(output);
}

// Common id-bearing keys across MCP tool inputs/outputs, checked in priority
// order so the most specific id wins the deep link.
const ID_KEYS = [
  "trace_id",
  "traceId",
  "experiment_slug",
  "experimentSlug",
  "dataset_id",
  "datasetId",
  "evaluator_id",
  "evaluatorId",
  "monitor_id",
  "monitorId",
  "dashboard_id",
  "dashboardId",
  "agent_id",
  "agentId",
  "scenario_id",
  "scenarioId",
  "run_id",
  "runId",
  "slug",
  "id",
];

/**
 * Best-effort primary resource id for a deep link. Prefers the tool's output
 * (a create returns the new id) then its input (a get was called with the id).
 */
export function extractPrimaryId(
  input: unknown,
  output: unknown,
): string | null {
  const fromText = matchIdInText(extractToolText(output));
  const fromOutput = firstIdIn(output);
  const fromInput = firstIdIn(input);
  return fromOutput ?? fromInput ?? fromText;
}

function firstIdIn(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  for (const key of ID_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

function matchIdInText(text: string): string | null {
  // `### Trace: <id>` from search_traces / a bare id near "trace".
  const trace = text.match(/Trace:\s*([A-Za-z0-9_-]{6,})/);
  return trace ? trace[1]! : null;
}

// Human-facing name keys across MCP tool inputs/outputs.
const NAME_KEYS = ["name", "title", "label", "slug"];

/**
 * Best-effort human name for a resource a tool created / touched, preferring
 * the tool output (a create echoes the saved name) then its input.
 */
export function extractResourceName(
  input: unknown,
  output: unknown,
): string | null {
  return firstNameIn(output) ?? firstNameIn(input);
}

function firstNameIn(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  for (const key of NAME_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

/**
 * A tool output the backend STAGED as a proposal (`langyProposal: true`). These
 * ride ProposalCard's Apply / Discard (or red confirm) path, never a capability
 * card — both the activity collapser and the card dispatcher skip them.
 */
export function isProposalOutput(output: unknown): boolean {
  return (
    !!output &&
    typeof output === "object" &&
    (output as { langyProposal?: unknown }).langyProposal === true
  );
}

/** First N non-empty, non-heading lines of a tool's textual result. */
export function summaryLines(output: unknown, max = 3): string[] {
  return extractToolText(output)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith(">") && !l.startsWith("#"))
    .slice(0, max);
}
