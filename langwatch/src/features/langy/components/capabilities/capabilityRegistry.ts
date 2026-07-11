/**
 * Domain-capability registry (task #12).
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
 * Anything this registry does not map returns null and falls through to the
 * existing raw-JSON fallback in LangyToolActivity.
 */

export type CapabilitySurface =
  | "traces"
  | "analytics"
  | "experiments"
  | "evaluations"
  | "datasets"
  | "prompts"
  | "dashboards"
  | "simulations"
  | "agents"
  | "automations";

/** Visual tone of the shared capability-card shell. */
export type CapabilityTone = "read" | "created" | "updated" | "removed";

/** Which bespoke renderer draws the card. */
export type CapabilityRenderKind =
  | "traces"
  | "trace"
  | "metrics"
  | "evalRun"
  | "dataset"
  | "scenario"
  | "promptDiff"
  | "resourceRead"
  | "resourceCreated"
  | "resourceUpdated"
  | "resourceRemoved";

export interface CapabilityDescriptor {
  render: CapabilityRenderKind;
  tone: CapabilityTone;
  surface: CapabilitySurface;
  /** Mono overline label, e.g. "Traces", "New evaluator", "Delete dashboard". */
  overline: string;
}

/** Props every bespoke capability card receives from the renderer. */
export interface CapabilityCardInput {
  descriptor: CapabilityDescriptor;
  /** The tool call's input arguments (ids, filters, the drafted resource). */
  input: unknown;
  /** The tool call's settled output (the result to render). */
  output: unknown;
  /** Current project slug, for building deep links. */
  projectSlug?: string | null;
}

/** Human label for the "Open in <surface>" deep-link chip. */
export const SURFACE_LABEL: Record<CapabilitySurface, string> = {
  traces: "Traces",
  analytics: "Analytics",
  experiments: "Experiments",
  evaluations: "Evaluations",
  datasets: "Datasets",
  prompts: "Prompts",
  dashboards: "Dashboards",
  simulations: "Simulations",
  agents: "Agents",
  automations: "Automations",
};

/** Project-relative base path for each surface's index page. */
const SURFACE_PATH: Record<CapabilitySurface, string> = {
  traces: "messages",
  analytics: "analytics",
  experiments: "experiments",
  evaluations: "evaluations",
  datasets: "datasets",
  prompts: "prompts",
  dashboards: "analytics/custom",
  simulations: "simulations",
  agents: "agents",
  automations: "automations",
};

// Surfaces whose index route accepts a trailing resource id as a deep segment
// (`/messages/<traceId>`, `/experiments/<slug>`, `/datasets/<id>`,
// `/evaluations/<id>`). Others deep-link to their index page only.
const SURFACE_ACCEPTS_ID: Partial<Record<CapabilitySurface, boolean>> = {
  traces: true,
  experiments: true,
  datasets: true,
  evaluations: true,
};

/**
 * Build a project-scoped deep link to a surface, optionally targeting one
 * resource. Returns null without a project slug so callers can hide the chip
 * rather than link to a broken path.
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
  const base = `/${projectSlug}/${SURFACE_PATH[surface]}`;
  if (resourceId && SURFACE_ACCEPTS_ID[surface]) {
    return `${base}/${encodeURIComponent(resourceId)}`;
  }
  return base;
}

// Nouns this registry knows a surface for. A tool whose noun is absent here
// (projects, api_keys, secrets, model_providers, workflows, annotations, the
// docs/schema helpers) is intentionally unmapped and falls to the JSON view.
const SURFACE_BY_NOUN: Record<string, CapabilitySurface> = {
  evaluator: "evaluations",
  evaluators: "evaluations",
  monitor: "evaluations",
  monitors: "evaluations",
  trigger: "automations",
  triggers: "automations",
  dashboard: "dashboards",
  dashboards: "dashboards",
  agent: "agents",
  agents: "agents",
  dataset: "datasets",
  datasets: "datasets",
  dataset_record: "datasets",
  dataset_records: "datasets",
  prompt: "prompts",
  prompts: "prompts",
  scenario: "simulations",
  scenarios: "simulations",
  suite: "simulations",
  suites: "simulations",
  simulation_run: "simulations",
  simulation_runs: "simulations",
  experiment: "experiments",
  experiments: "experiments",
};

// The datasets / simulations surfaces have bespoke read cards; other reads use
// the generic resource-read card.
const READ_RENDER_BY_SURFACE: Partial<
  Record<CapabilitySurface, CapabilityRenderKind>
> = {
  datasets: "dataset",
  simulations: "scenario",
};

// Tool names that don't follow the plain `platform_<verb>_<noun>` shape, or
// that want a card other than the verb/noun default.
const EXPLICIT: Record<string, CapabilityDescriptor> = {
  search_traces: {
    render: "traces",
    tone: "read",
    surface: "traces",
    overline: "Traces",
  },
  get_trace: {
    render: "trace",
    tone: "read",
    surface: "traces",
    overline: "Trace",
  },
  get_analytics: {
    render: "metrics",
    tone: "read",
    surface: "analytics",
    overline: "Analytics",
  },
  platform_run_experiment: {
    render: "evalRun",
    tone: "read",
    surface: "experiments",
    overline: "Experiment run",
  },
  platform_run_suite: {
    render: "evalRun",
    tone: "read",
    surface: "simulations",
    overline: "Suite run",
  },
  platform_experiment_results: {
    render: "evalRun",
    tone: "read",
    surface: "experiments",
    overline: "Experiment results",
  },
  platform_experiment_status: {
    render: "evalRun",
    tone: "read",
    surface: "experiments",
    overline: "Experiment run",
  },
  platform_update_prompt: {
    render: "promptDiff",
    tone: "updated",
    surface: "prompts",
    overline: "Prompt update",
  },
};

/**
 * Strip an MCP namespace prefix a router may prepend (`mcp__langwatch__foo`,
 * `langwatch.foo`) so classification works whether the stream carries the bare
 * tool name (as today's activity map assumes) or a namespaced one.
 */
export function normalizeToolName(name: string): string {
  let n = name.trim();
  const mcp = n.match(/^mcp__[^_]+__(.+)$/);
  if (mcp) n = mcp[1]!;
  n = n.replace(/^langwatch[._]/, "");
  return n;
}

/** `create` → "New", `delete`/`archive`/`revoke` → "Delete", etc. */
function verbLabel(verb: string): string {
  switch (verb) {
    case "create":
      return "New";
    case "update":
      return "Update";
    case "delete":
    case "archive":
    case "revoke":
      return "Delete";
    case "run":
      return "Run";
    default:
      return "";
  }
}

function nounLabel(noun: string): string {
  const singular = noun.replace(/_records?$/, " records").replace(/s$/, "");
  return singular.replace(/_/g, " ");
}

/**
 * Resolve a tool name to the card that should render it, or null to fall
 * through to the raw-JSON view.
 */
export function resolveCapability(
  rawName: string,
): CapabilityDescriptor | null {
  const name = normalizeToolName(rawName);
  if (EXPLICIT[name]) return EXPLICIT[name];

  const platform = name.startsWith("platform_")
    ? name.slice("platform_".length)
    : name;
  const underscore = platform.indexOf("_");
  if (underscore === -1) return null;
  const verb = platform.slice(0, underscore);
  const noun = platform.slice(underscore + 1);

  const surface = SURFACE_BY_NOUN[noun];
  if (!surface) return null;

  const readable = nounLabel(noun);
  switch (verb) {
    case "create":
      return {
        render: "resourceCreated",
        tone: "created",
        surface,
        overline: `New ${readable}`,
      };
    case "update":
      return {
        render: "resourceUpdated",
        tone: "updated",
        surface,
        overline: `Update ${readable}`,
      };
    case "delete":
    case "archive":
    case "revoke":
      return {
        render: "resourceRemoved",
        tone: "removed",
        surface,
        overline: `${verbLabel(verb)} ${readable}`,
      };
    case "run":
      return {
        render: "evalRun",
        tone: "read",
        surface,
        overline: `Run ${readable}`,
      };
    case "list":
    case "get":
      return {
        render: READ_RENDER_BY_SURFACE[surface] ?? "resourceRead",
        tone: "read",
        surface,
        overline: verb === "list" ? SURFACE_LABEL[surface] : readable,
      };
    default:
      return null;
  }
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
          c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string"
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
