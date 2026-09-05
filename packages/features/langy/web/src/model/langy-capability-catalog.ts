/**
 * The capability catalog — one declarative row per CLI resource.
 * @see specs/langy/langy-capability-cards.feature
 */
import type { DigestStrategy } from "@langwatch/langy-contract";

/**
 * Every platform surface a card can point at. The label, path, icon and deep-link rules
 * for each live in `langy-capability-registry.ts` / `langy-capability-card.tsx`; this
 * is the vocabulary they key off.
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
  "scenarios",
  "agents",
  "automations",
  "workflows",
  "annotations",
  "secrets",
  "projects",
  "apiKeys",
  "modelProviders",
  "gateway",
  "organization",
  "platform",
] as const;

export type CapabilitySurface = (typeof CAPABILITY_SURFACES)[number];

/**
 * The widget vocabulary a card body can be drawn with. Rendering lives in
 * `langy-declarative-card.tsx`; the catalog only names which one.
 */
export type CapabilityBodyWidget = "stats" | "rows" | "facts" | "diff" | "text" | "chart";

/**
 * Icon overrides a catalog row may name when the surface's own icon is wrong for the
 * resource (a virtual key on the gateway surface is a key, not a network).
 */
export type CapabilityIconName =
  | "key"
  | "coins"
  | "radioTower"
  | "shieldCheck"
  | "slidersHorizontal"
  | "users"
  | "building";

/** The verb tones a body override can key on (mirrors `CliVerbTone`). */
type CatalogTone = "read" | "created" | "updated" | "removed";

export interface CapabilityCatalogEntry {
  /** The platform surface this resource's cards belong to and deep-link into. */
  surface: CapabilitySurface;
  /**
   * How this resource's results are remembered and re-rendered — REQUIRED, so a new CLI
   * resource cannot ship without deciding it (the coverage test enforces the
   * declaration alongside the row itself):
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
   * `byTone[tone]` → `default` → derived from the card kind (collection → rows, single
   * resource → facts, run → stats, diff → diff, write → text).
   */
  body?: {
    default?: CapabilityBodyWidget;
    byTone?: Partial<Record<CatalogTone, CapabilityBodyWidget>>;
    byVerb?: Record<string, CapabilityBodyWidget>;
  };
}

/**
 * One row per CLI resource — every top-level `langwatch <resource>` command except the
 * auth/utility ones a card would be meaningless for (login, config, daemon…; the
 * coverage test pins that exclusion list).
 */
export const CAPABILITY_CATALOG = {
  trace: {
    surface: "traces",
    digestStrategy: "id-ref",
    noun: { singular: "trace", plural: "traces" },
  },
  session: {
    // Deep-links to the traces surface, which is where a session is opened.
    // `id-ref` because a session result is addressed by its session id.
    surface: "traces",
    digestStrategy: "id-ref",
    noun: { singular: "session", plural: "sessions" },
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
  // Agent-driven page control (specs/langy/langy-ui-actions.feature): the
  // result is the dispatch outcome (status, executed via, action kind), which
  // the card shows as facts while the page changes in front of the user.
  ui: {
    surface: "experiments",
    digestStrategy: "text",
    noun: { singular: "UI action", plural: "UI actions" },
  },
  workbench: {
    surface: "experiments",
    digestStrategy: "text",
    noun: { singular: "workbench", plural: "workbenches" },
  },
  monitor: {
    surface: "evaluations",
    digestStrategy: "id-ref",
    noun: { singular: "monitor", plural: "monitors" },
  },
  scenario: {
    surface: "scenarios",
    digestStrategy: "id-ref",
    noun: { singular: "scenario", plural: "scenarios" },
  },
  "simulation-run": {
    surface: "simulations",
    digestStrategy: "id-ref",
    noun: { singular: "simulation run", plural: "simulation runs" },
  },
  "test-suite": {
    surface: "simulations",
    digestStrategy: "id-ref",
    noun: { singular: "test suite", plural: "test suites" },
  },
  "run-plan": {
    surface: "simulations",
    digestStrategy: "id-ref",
    noun: { singular: "run plan", plural: "run plans" },
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
  chart: {
    surface: "dashboards",
    digestStrategy: "id-ref",
    noun: { singular: "chart", plural: "charts" },
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
  webhooks: {
    surface: "gateway",
    digestStrategy: "id-ref",
    noun: { singular: "webhook endpoint", plural: "webhook endpoints" },
    icon: "radioTower",
  },
  "spend-events": {
    surface: "gateway",
    digestStrategy: "reduced",
    noun: { singular: "spend event", plural: "spend events" },
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
  // ── Organization provisioning ──────────────────────────────────────────────
  // Every one of these reads or writes access rather than product data, so they
  // share the organization surface and none of them deep-links: the settings
  // pages they belong to have no per-resource route.
  organization: {
    surface: "organization",
    // One organization per credential, addressed by nothing: the result is the
    // profile itself, so there is no id to hydrate from.
    digestStrategy: "reduced",
    noun: { singular: "organization", plural: "organization" },
    icon: "building",
  },
  members: {
    surface: "organization",
    digestStrategy: "id-ref",
    noun: { singular: "member", plural: "members" },
    icon: "users",
    body: {
      // The access breakdown is a list of grants, not a single resource.
      byVerb: { access: "rows" },
    },
  },
  invites: {
    surface: "organization",
    digestStrategy: "id-ref",
    noun: { singular: "invite", plural: "invites" },
    icon: "users",
  },
  teams: {
    surface: "organization",
    digestStrategy: "id-ref",
    noun: { singular: "team", plural: "teams" },
    icon: "users",
    body: { byVerb: { members: "rows" } },
  },
  groups: {
    surface: "organization",
    digestStrategy: "id-ref",
    noun: { singular: "access group", plural: "access groups" },
    icon: "users",
    body: { byVerb: { members: "rows", bindings: "rows" } },
  },
  roles: {
    surface: "organization",
    digestStrategy: "id-ref",
    noun: { singular: "custom role", plural: "custom roles" },
    icon: "shieldCheck",
    // The permission catalog is a reference table, not this org's roles.
    body: { byVerb: { permissions: "rows" } },
  },
  "role-bindings": {
    surface: "organization",
    digestStrategy: "id-ref",
    noun: { singular: "role binding", plural: "role bindings" },
    icon: "shieldCheck",
  },
  "scim-tokens": {
    surface: "organization",
    digestStrategy: "id-ref",
    noun: { singular: "SCIM token", plural: "SCIM tokens" },
    icon: "key",
  },
  organizations: {
    surface: "organization",
    digestStrategy: "id-ref",
    noun: { singular: "organization", plural: "organizations" },
    icon: "building",
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
