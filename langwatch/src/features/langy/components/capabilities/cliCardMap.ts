/**
 * CLI tool call -> which card draws it: Langy's view binding over the feature map.
 *
 * A Langy tool call is `langwatch trace search`, recorded by the server's CLI
 * envelope as the typed name `langwatch.trace.search` (see
 * `src/server/services/langy/execution/langy-cli-envelope.service.ts`). This
 * module says which capability card renders it.
 *
 * The STRUCTURE is derived, never duplicated: which CLI commands exist, and
 * which feature owns them, comes from `feature-map.json` via `featureMap.ts`.
 * What this module adds is the two things the map has no business knowing:
 *
 *   1. The Langy panel's CARD BINDING — which card draws a feature's results.
 *      That is a fact about this view, not about the feature (the same feature is
 *      also a sidebar entry, a docs page, a CLI command), so it lives here, keyed
 *      by feature id, and another view would write its own.
 *   2. The CLI's VERB GRAMMAR — `list` reads, `create` writes, `delete` is
 *      destructive, `run` produces a run. This is the propose-then-apply
 *      classification of the card catalogue, applied to the CLI's verbs.
 *
 * It resolves STRUCTURE only (surface, card, tone) — never labels. Wording a
 * capability is `capabilityRegistry`'s job and stays in one place; this module
 * imports only types from it, so there is no runtime dependency in either
 * direction.
 *
 * A CLI command the map doesn't list, or a feature this view has no card for,
 * resolves to null and falls through to Langy's raw activity view.
 *
 * @see specs/langy/langy-cli-tool-envelope.feature
 */
import type {
  CapabilityRenderKind,
  CapabilitySurface,
  CapabilityTone,
} from "./capabilityRegistry";
import {
  featureForCliCommand,
  parseCliToolName,
  type CliCommand,
} from "~/shared/langy/featureMap";

/** How the Langy panel draws one feature's results. */
interface FeatureCard {
  surface: CapabilitySurface;
  /** The card a READ of this feature renders in. */
  render: CapabilityRenderKind;
  /** CLI verbs whose result wants a different card than the feature's default. */
  renderByVerb?: Record<string, CapabilityRenderKind>;
}

/**
 * Langy's card binding, keyed by `feature-map.json` feature id. A feature absent
 * here has no Langy card yet, and its calls fall back to raw activity.
 * `cliCardMap.unit.test.ts` pins every key to a real feature id, so a rename in
 * the map fails the build rather than silently dropping a card.
 */
export const CARD_BY_FEATURE: Record<string, FeatureCard> = {
  "observability.tracing": {
    surface: "traces",
    // A search renders the sample card — the matched traces themselves, and a
    // way through to the same result set in the Trace Explorer. A single `get`
    // has one trace to show and renders the one-trace summary instead.
    render: "traceSample",
    renderByVerb: { get: "trace" },
  },
  "observability.analytics": { surface: "analytics", render: "metrics" },
  "observability.annotations": {
    surface: "annotations",
    render: "resourceRead",
  },
  "evaluations.experiments": {
    surface: "experiments",
    render: "evalRun",
    renderByVerb: { list: "resourceRead" },
  },
  "evaluations.online-evaluation": {
    surface: "evaluations",
    render: "resourceRead",
  },
  "agent-simulations.scenarios": {
    surface: "simulations",
    render: "scenario",
    renderByVerb: { run: "evalRun" },
  },
  "agent-simulations.runs": { surface: "simulations", render: "evalRun" },
  "agent-simulations.suites": {
    surface: "simulations",
    render: "evalRun",
    renderByVerb: { list: "resourceRead", get: "resourceRead" },
  },
  "prompt-management.prompts": {
    surface: "prompts",
    render: "resourceRead",
    renderByVerb: { push: "promptDiff", sync: "promptDiff" },
  },
  "library.agents": {
    surface: "agents",
    render: "resourceRead",
    renderByVerb: { run: "evalRun" },
  },
  "library.workflows": {
    surface: "workflows",
    render: "resourceRead",
    renderByVerb: { run: "evalRun" },
  },
  "library.evaluators": { surface: "evaluations", render: "resourceRead" },
  "library.datasets": {
    surface: "datasets",
    render: "dataset",
    renderByVerb: { records: "dataset" },
  },
  dashboards: { surface: "dashboards", render: "resourceRead" },
  triggers: { surface: "automations", render: "resourceRead" },
  "settings.projects": { surface: "projects", render: "resourceRead" },
  "settings.api-keys": { surface: "apiKeys", render: "resourceRead" },
  "settings.model-providers": {
    surface: "modelProviders",
    render: "resourceRead",
  },
  "settings.secrets": { surface: "secrets", render: "resourceRead" },
};

const CREATE_VERBS = new Set(["create", "add", "upload", "init"]);
const UPDATE_VERBS = new Set([
  "update",
  "rename",
  "set",
  "assign",
  "restore",
  "sync",
  "push",
  "pull",
  "duplicate",
]);
const REMOVE_VERBS = new Set(["delete", "remove", "revoke", "archive"]);

/**
 * CLI verbs that read a COLLECTION rather than one resource. Only used for
 * wording ("Traces" vs "Trace"), which is why it is exported for the registry
 * rather than resolved here.
 */
export const CLI_COLLECTION_VERBS: ReadonlySet<string> = new Set([
  "list",
  "search",
  "query",
  "versions",
  "list-runs",
  "records",
  "tag",
]);

/** A resolved CLI call: the card to draw, and the command it came from. */
export interface CliCapability {
  command: CliCommand;
  surface: CapabilitySurface;
  render: CapabilityRenderKind;
  tone: CapabilityTone;
}

/** The tone a CLI verb carries: reads are inert, writes are not. */
function toneFor(verb: string): CapabilityTone {
  if (CREATE_VERBS.has(verb)) return "created";
  if (UPDATE_VERBS.has(verb)) return "updated";
  if (REMOVE_VERBS.has(verb)) return "removed";
  return "read";
}

/**
 * The card for a verb: the feature's per-verb override wins, then the verb class
 * (a create renders as a "created" card, a run as a run card), then the
 * feature's default read card.
 */
function renderFor({
  verb,
  tone,
  card,
}: {
  verb: string;
  tone: CapabilityTone;
  card: FeatureCard;
}): CapabilityRenderKind {
  const override = card.renderByVerb?.[verb];
  if (override) return override;
  if (tone === "created") return "resourceCreated";
  if (tone === "updated") return "resourceUpdated";
  if (tone === "removed") return "resourceRemoved";
  if (verb === "run") return "evalRun";
  return card.render;
}

/**
 * Resolve a CLI tool name (`langwatch.trace.search`) to the card that draws it,
 * or null when the map knows no such command or this view has no card for the
 * feature that owns it.
 */
export function resolveCliCapability(rawName: string): CliCapability | null {
  const command = parseCliToolName(rawName);
  if (!command) return null;

  const feature = featureForCliCommand(command);
  if (!feature) return null;

  const card = CARD_BY_FEATURE[feature.id];
  if (!card) return null;

  const tone = toneFor(command.verb);
  return {
    command,
    surface: card.surface,
    render: renderFor({ verb: command.verb, tone, card }),
    tone,
  };
}
