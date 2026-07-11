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
 * Anything this registry does not map returns null and falls through to the
 * existing raw-JSON fallback in LangyToolActivity. The read tools that stay on
 * the fallback are ONLY the docs/schema helpers (`fetch_langwatch_docs`,
 * `fetch_scenario_docs`, `discover_schema`), which render as clean activity
 * lines (see LangyToolActivity), not raw JSON — every resource read has a card.
 *
 * TRANSPORT: Langy calls the `langwatch` CLI, so a live tool call arrives as
 * `langwatch.<resource>.<verb>` — rewritten server-side by the CLI envelope out
 * of the `bash` call opencode actually made. Those resolve through `cliCardMap`,
 * which derives the structure from `feature-map.json`; this module words them.
 * The older MCP transport (`platform_*` / `search_traces`) has been retired: a
 * name that is not a CLI call now falls straight through to the raw view.
 */

import {
  CLI_COLLECTION_VERBS,
  resolveCliCapability,
  type CliCapability,
} from "./cliCardMap";

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
  | "automations"
  | "workflows"
  | "annotations"
  | "secrets"
  | "projects"
  | "apiKeys"
  | "modelProviders";

/** Visual tone of the shared capability-card shell. */
export type CapabilityTone = "read" | "created" | "updated" | "removed";

/** Which bespoke renderer draws the card. */
export type CapabilityRenderKind =
  | "traces"
  /**
   * A trace SEARCH: a sample of the matched traces, each clickable through to
   * its drawer, plus a "View in Trace Explorer" link carrying the agent's actual
   * query. Distinct from `traces` (the older id-and-snippet list), which the
   * legacy MCP transport still resolves to.
   */
  | "traceSample"
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
  workflows: "Workflows",
  annotations: "Annotations",
  secrets: "Secrets",
  projects: "Projects",
  apiKeys: "API keys",
  modelProviders: "Model providers",
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
  workflows: "workflows",
  annotations: "annotations",
  // Settings/org surfaces — never deep-linked (see SURFACE_NO_DEEPLINK); paths
  // are placeholders only to satisfy the exhaustive Record.
  secrets: "settings",
  projects: "settings/projects",
  apiKeys: "settings/authentication",
  modelProviders: "settings/model-providers",
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

// Settings / org-level surfaces whose reads render a card but have no clean
// project-scoped page to deep-link to. The card shows the result without an
// "Open in <surface>" chip rather than linking somewhere wrong.
const SURFACE_NO_DEEPLINK: Partial<Record<CapabilitySurface, boolean>> = {
  secrets: true,
  projects: true,
  apiKeys: true,
  modelProviders: true,
};

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
  if (SURFACE_NO_DEEPLINK[surface]) return null;
  const base = `/${projectSlug}/${SURFACE_PATH[surface]}`;
  if (resourceId && SURFACE_ACCEPTS_ID[surface]) {
    return `${base}/${encodeURIComponent(resourceId)}`;
  }
  return base;
}

/**
 * How a CLI verb READS, in both tenses. `past` titles a SETTLED write card ("New
 * evaluator", "Delete trigger"); `present` titles a RUNNING one ("Creating
 * evaluator"). Keeping the two tenses in ONE row is the point: the two switch
 * statements this replaced could word the same verb inconsistently, and did.
 * A read verb has no past-tense label — a read card is titled by its surface,
 * not its verb — so its `past` is empty.
 *
 * The verb's TONE (read / create / update / remove) is `cliCardMap`'s to decide;
 * it classifies verbs for the whole card catalogue and stays the single source
 * of that truth, so it is deliberately not duplicated here.
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
  create: { past: "New", present: "Creating" },
  init: { past: "New", present: "Creating" },
  add: { past: "Add to", present: "Adding to" },
  upload: { past: "Upload to", present: "Uploading to" },
  update: { past: "Update", present: "Updating" },
  set: { past: "Set", present: "Updating" },
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

/** `dataset_records` / `simulation-run` → "dataset records" / "simulation run". */
function nounLabel(noun: string): string {
  const singular = noun.replace(/_records?$/, " records").replace(/s$/, "");
  return singular.replace(/[_-]/g, " ");
}

/**
 * Word a CLI capability. The CLI's verb grammar is resolved in `cliCardMap`;
 * how it READS is decided here, alongside the MCP wording, so both transports
 * speak with one voice: a collection read is titled by its surface ("Traces"),
 * a single read by its resource ("trace"), a write by what it did.
 */
function cliOverline({ command, tone, surface }: CliCapability): string {
  const noun = nounLabel(command.resource);
  if (tone !== "read") {
    return `${verbLabel(command.verb) || command.verb} ${noun}`;
  }
  if (command.verb === "run") return `Run ${noun}`;
  if (CLI_COLLECTION_VERBS.has(command.verb)) return SURFACE_LABEL[surface];
  return noun;
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
    ? SURFACE_LABEL[cli.surface].toLowerCase()
    : nounLabel(cli.command.resource);
  return {
    surface: cli.surface,
    overline: SURFACE_LABEL[cli.surface],
    headline: `${progressVerb(cli.command.verb)} ${noun}`,
  };
}

/**
 * Resolve a CLI tool name (`langwatch.<resource>.<verb>`) to the card that
 * should render it, or null to fall through to the raw-JSON view. The feature
 * map (via `cliCardMap`) decides the structure; `cliOverline` words it.
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
