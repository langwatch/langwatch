/**
 * The capability catalog — one declarative row per CLI resource.
 *
 * Langy's tool calls arrive as `langwatch.<resource>.<verb>`, and this file is
 * the panel's answer to "what does a result for that resource look like":
 * which surface it belongs to, what the thing is called, and which body widget
 * draws the result. It is DATA ONLY — no JSX, no functions — so adding a new
 * CLI resource to the panel is adding one row here, and the coverage test
 * (`capabilityCatalog.coverage.unit.test.ts`) fails the build when this map
 * and the CLI's own command tree drift in either direction.
 *
 * WHICH card kind a verb produces and its tone are NOT here: those are CLI
 * grammar, owned by `@langwatch/cli-cards` (`cardKindFor`, `cliVerbTone`).
 * This catalog only binds the view on top — the same split the registry has
 * always kept.
 *
 * A resource missing from this catalog still renders (see
 * `resolveCliCapability`): the name is humanised into wording, the shared
 * grammar picks the card kind, and the card shows without a deep link. The
 * catalog makes cards GOOD; it is deliberately not what makes them EXIST.
 *
 * @see specs/langy/langy-capability-cards.feature
 */
import type { DigestStrategy } from "@langwatch/cli-cards";

/**
 * Every platform surface a card can point at. The label, path, icon and
 * deep-link rules for each live in `capabilityRegistry.ts` /
 * `LangyCapabilityCard.tsx`; this is the vocabulary they key off.
 *
 * `gateway` covers the AI Gateway's org-level pages (virtual keys, budgets,
 * governance, ingestion) — settings surfaces, so never deep-linked.
 * `platform` is the fallback surface for a resource the catalog has never
 * heard of: a neutral icon, no deep link, wording from the command itself.
 */
export const CAPABILITY_SURFACES = [
  "traces",
  "analytics",
  "experiments",
  "evaluations",
  "evaluators",
  "datasets",
  "prompts",
  "dashboards",
  "simulations",
  "agents",
  "automations",
  "workflows",
  "annotations",
  "secrets",
  "projects",
  "apiKeys",
  "modelProviders",
  "gateway",
  "platform",
] as const;

export type CapabilitySurface = (typeof CAPABILITY_SURFACES)[number];

/**
 * The widget vocabulary a card body can be drawn with. Rendering lives in
 * `LangyDeclarativeCard.tsx`; the catalog only names which one.
 *
 *   - `stats` — labelled figures that roll up on mount (counts, pass rates).
 *   - `rows`  — a short list of items, each with a primary/secondary line.
 *   - `facts` — a label→value grid for one resource (name, status, dates).
 *   - `diff`  — name/version header plus the fields that changed.
 *   - `text`  — the plain summary-lines fallback.
 */
export type CapabilityBodyWidget = "stats" | "rows" | "facts" | "diff" | "text";

/**
 * Icon overrides a catalog row may name when the surface's own icon is wrong
 * for the resource (a virtual key on the gateway surface is a key, not a
 * network). The name→glyph binding lives with the JSX in
 * `LangyCapabilityCard.tsx`, keyed exhaustively off this union.
 */
export type CapabilityIconName =
  | "key"
  | "coins"
  | "radioTower"
  | "shieldCheck"
  | "slidersHorizontal";

/** The verb tones a body override can key on (mirrors `CliVerbTone`). */
type CatalogTone = "read" | "created" | "updated" | "removed";

export interface CapabilityCatalogEntry {
  /** The platform surface this resource's cards belong to and deep-link into. */
  surface: CapabilitySurface;
  /**
   * How this resource's results are remembered and re-rendered — REQUIRED, so
   * a new CLI resource cannot ship without deciding it (the coverage test
   * enforces the declaration alongside the row itself):
   *
   *   - `id-ref`     results name entities; the digest stores ids and the card
   *                  hydrates fresh data with the viewer's session.
   *   - `query-ref`  results are aggregates; the digest stores the query and
   *                  the card re-runs it.
   *   - `reduced`    results parse but name nothing fetchable; the card renders
   *                  the stored structure.
   *   - `text`       results are opaque output, rendered as text.
   *
   * This is the resource's INTENDED tier. The extractor still resolves the
   * actual tier per result (an id-ref resource whose output held no ids
   * degrades to reduced/text), so the declaration documents and enforces,
   * never fabricates.
   */
  digestStrategy: DigestStrategy;
  /**
   * What the thing is called, in customer words. `singular` titles writes and
   * single reads ("New virtual key", "trace"); `plural` titles collection
   * reads ("Virtual keys").
   */
  noun: { singular: string; plural: string };
  /** Overline icon override when the surface icon isn't right. */
  icon?: CapabilityIconName;
  /**
   * Which body widget draws the result. Resolution order: `byVerb[verb]` →
   * `byTone[tone]` → `default` → derived from the card kind (collection →
   * rows, single resource → facts, run → stats, diff → diff, write → text).
   * Most rows omit this entirely and ride the derived default.
   */
  body?: {
    default?: CapabilityBodyWidget;
    byTone?: Partial<Record<CatalogTone, CapabilityBodyWidget>>;
    byVerb?: Record<string, CapabilityBodyWidget>;
  };
}

/**
 * One row per CLI resource — every top-level `langwatch <resource>` command
 * except the auth/utility ones a card would be meaningless for (login, config,
 * daemon…; the coverage test pins that exclusion list). Keyed by the resource
 * word exactly as the CLI spells it.
 */
export const CAPABILITY_CATALOG = {
  trace: {
    surface: "traces",
    digestStrategy: "id-ref",
    noun: { singular: "trace", plural: "traces" },
  },
  analytics: {
    surface: "analytics",
    digestStrategy: "query-ref",
    noun: { singular: "analytics query", plural: "analytics" },
  },
  annotation: {
    surface: "annotations",
    digestStrategy: "id-ref",
    noun: { singular: "annotation", plural: "annotations" },
  },
  experiment: {
    surface: "experiments",
    digestStrategy: "id-ref",
    noun: { singular: "experiment", plural: "experiments" },
  },
  monitor: {
    surface: "evaluations",
    digestStrategy: "id-ref",
    noun: { singular: "monitor", plural: "monitors" },
  },
  scenario: {
    surface: "simulations",
    digestStrategy: "id-ref",
    noun: { singular: "scenario", plural: "scenarios" },
  },
  "simulation-run": {
    surface: "simulations",
    digestStrategy: "id-ref",
    noun: { singular: "simulation run", plural: "simulation runs" },
  },
  suite: {
    surface: "simulations",
    digestStrategy: "id-ref",
    noun: { singular: "suite", plural: "suites" },
  },
  prompt: {
    surface: "prompts",
    digestStrategy: "id-ref",
    noun: { singular: "prompt", plural: "prompts" },
  },
  agent: {
    surface: "agents",
    digestStrategy: "id-ref",
    noun: { singular: "agent", plural: "agents" },
  },
  workflow: {
    surface: "workflows",
    digestStrategy: "id-ref",
    noun: { singular: "workflow", plural: "workflows" },
  },
  evaluator: {
    surface: "evaluators",
    digestStrategy: "id-ref",
    noun: { singular: "evaluator", plural: "evaluators" },
  },
  dataset: {
    surface: "datasets",
    digestStrategy: "id-ref",
    noun: { singular: "dataset", plural: "datasets" },
  },
  dashboard: {
    surface: "dashboards",
    digestStrategy: "id-ref",
    noun: { singular: "dashboard", plural: "dashboards" },
  },
  graph: {
    surface: "dashboards",
    digestStrategy: "id-ref",
    noun: { singular: "graph", plural: "graphs" },
  },
  trigger: {
    surface: "automations",
    digestStrategy: "id-ref",
    noun: { singular: "trigger", plural: "triggers" },
  },
  projects: {
    surface: "projects",
    digestStrategy: "id-ref",
    noun: { singular: "project", plural: "projects" },
  },
  "api-keys": {
    surface: "apiKeys",
    digestStrategy: "id-ref",
    noun: { singular: "API key", plural: "API keys" },
  },
  "model-provider": {
    surface: "modelProviders",
    digestStrategy: "id-ref",
    noun: { singular: "model provider", plural: "model providers" },
  },
  "model-default": {
    surface: "modelProviders",
    digestStrategy: "reduced",
    noun: { singular: "default model", plural: "default models" },
    icon: "slidersHorizontal",
  },
  secret: {
    surface: "secrets",
    digestStrategy: "id-ref",
    noun: { singular: "secret", plural: "secrets" },
  },
  "virtual-keys": {
    surface: "gateway",
    digestStrategy: "id-ref",
    noun: { singular: "virtual key", plural: "virtual keys" },
    icon: "key",
  },
  "gateway-budgets": {
    surface: "gateway",
    digestStrategy: "id-ref",
    noun: { singular: "gateway budget", plural: "gateway budgets" },
    icon: "coins",
  },
  governance: {
    surface: "gateway",
    digestStrategy: "reduced",
    noun: { singular: "governance setup", plural: "governance setup" },
    icon: "shieldCheck",
    body: {
      byVerb: {
        status: "facts",
        // `governance ingestion-templates <get|create|…>` collapses onto this
        // verb; the templates read as a list.
        "ingestion-templates": "rows",
      },
    },
  },
  ingest: {
    surface: "gateway",
    digestStrategy: "reduced",
    noun: { singular: "ingestion source", plural: "ingestion sources" },
    icon: "radioTower",
    body: {
      byVerb: {
        // `ingest tail` streams recent events — a list, not one resource.
        tail: "rows",
        // `ingest health` reports event counts over time windows — figures.
        health: "stats",
      },
    },
  },
} as const satisfies Record<string, CapabilityCatalogEntry>;

export type CatalogResource = keyof typeof CAPABILITY_CATALOG;
