/**
 * Registry: which card reads which CLI command; unknown →generic.
 */
import type * as z from "zod";

import {
  dashboardProbeSchema,
  evaluatorConfigProbeSchema,
  SCHEMA_BY_CARD_KIND,
  spendProbeSchema,
  timeseriesProbeSchema,
  type MeasuredCardKind,
} from "./schemas.ts";

/**
 * Shape-driven promotion: promote defaults only, rank by eligibility, ties explicit.
 * See dev/docs/adr/079-card-selection-is-deterministic.md.
 */

/**
 * Promotable from: DEFAULT cards only (not byVerb); metrics matters for analytics.
 */
const PROMOTABLE_FROM: ReadonlySet<MeasuredCardKind> = new Set<MeasuredCardKind>([
  "resourceRead",
  "metrics",
]);

export interface CardProbe {
  /** The card a payload matching `schema` is promoted to. */
  card: MeasuredCardKind;
  /**
   * Accepts ONLY payloads that genuinely are this shape. See rule 4 — a probe
   * that tolerates everything promotes everything.
   */
  schema: z.ZodType;
  /**
   * How specific this shape is. Higher wins. Unique across all probes, asserted
   * below, so the winner never depends on declaration order.
   */
  specificity: number;
  /** Why this shape earns this card — read by nobody, needed by everybody. */
  why: string;
}

/**
 * Assert that no two probes share a specificity, at module load. A
 * duplicate would resolve by array order, which shifts on the next edit -
 * exactly the bug this module exists to prevent. Fails at load, not render.
 */
export function assertTotalOrder(probes: readonly CardProbe[]): void {
  const seen = new Map<number, MeasuredCardKind>();
  for (const probe of probes) {
    const clash = seen.get(probe.specificity);
    if (clash !== undefined) {
      throw new Error(
        `Card probes must be totally ordered: '${probe.card}' and '${clash}' ` +
          `both claim specificity ${probe.specificity}.`,
      );
    }
    seen.set(probe.specificity, probe.card);
  }
}

/**
 * The best card a payload's SHAPE earns, or the nominal one when it earns none: an
 * unrecognised shape keeps today's card, so growing this list adds richness, never removes it.
 */
export function promoteCard({
  nominal,
  payload,
  probes,
}: {
  /** The card the command's name resolved to. */
  nominal: MeasuredCardKind;
  payload: unknown;
  probes: readonly CardProbe[];
}): MeasuredCardKind {
  if (!PROMOTABLE_FROM.has(nominal)) return nominal;

  let best: CardProbe | null = null;
  for (const probe of probes) {
    if (probe.card === nominal) continue;
    if (best && probe.specificity <= best.specificity) continue;
    const parsed = probe.schema.safeParse(payload);
    if (!parsed.success) continue;
    best = probe;
  }
  return best?.card ?? nominal;
}

/**
 * The shape probes, most specific first by SCORE (not by position — see
 * `promotion.ts`). A payload that lands on a generic card and matches one of
 * these is promoted to the richer card it has evidently earned.
 */
export const CARD_PROBES: readonly CardProbe[] = [
  {
    card: "timeseries",
    schema: timeseriesProbeSchema,
    specificity: 40,
    why: "carries named series of points over time — it IS a trend, and a trend outranks the total you could take of it",
  },
  {
    card: "dashboard",
    schema: dashboardProbeSchema,
    specificity: 30,
    why: "carries graph or panel definitions — it IS a visual",
  },
  {
    card: "spend",
    schema: spendProbeSchema,
    specificity: 20,
    why: "carries a named cost total, or rows that each carry one",
  },
  {
    card: "evaluatorConfig",
    schema: evaluatorConfigProbeSchema,
    specificity: 10,
    why: "carries an enabled flag or an evaluator type — a check's config",
  },
];

// The total order is asserted by `promotion.test.ts`, not at module load: a
// shared contract package that can throw on import turns one bad literal into
// an unresolvable module for every consumer, which is a far worse failure than
// the one it was guarding.

/** Verbs that write, and the card each writes into. */
const CARD_BY_WRITE_VERB: Record<string, MeasuredCardKind> = {
  create: "resourceCreated",
  add: "resourceCreated",
  upload: "resourceCreated",
  init: "resourceCreated",
  update: "resourceUpdated",
  rename: "resourceUpdated",
  set: "resourceUpdated",
  unset: "resourceUpdated",
  assign: "resourceUpdated",
  restore: "resourceUpdated",
  duplicate: "resourceUpdated",
  rotate: "resourceUpdated",
  sync: "promptDiff",
  push: "promptDiff",
  pull: "resourceUpdated",
  delete: "resourceRemoved",
  remove: "resourceRemoved",
  revoke: "resourceRemoved",
  archive: "resourceRemoved",
};

/** The visual tone a CLI verb carries: reads are inert, writes are not. */
export type CliVerbTone = "read" | "created" | "updated" | "removed";

const CREATE_VERBS = new Set(["create", "add", "upload", "init"]);
const UPDATE_VERBS = new Set([
  "update",
  "rename",
  "set",
  "unset",
  "assign",
  "restore",
  "sync",
  "push",
  "pull",
  "duplicate",
  "rotate",
]);
const REMOVE_VERBS = new Set(["delete", "remove", "revoke", "archive"]);

/**
 * The tone a verb reads in: create → `created`, delete → `removed`, read →
 * inert. CLI grammar, not the card: `sync` reads as `updated` here even
 * though its CARD is the prompt diff - tone and card answer different questions.
 */
export const cliVerbTone = (verb: string): CliVerbTone => {
  if (CREATE_VERBS.has(verb)) return "created";
  if (UPDATE_VERBS.has(verb)) return "updated";
  if (REMOVE_VERBS.has(verb)) return "removed";
  return "read";
};

/**
 * CLI verbs that read a COLLECTION rather than one resource. Used only for
 * wording ("Traces" vs "Trace") — the plural title a list earns and a get does
 * not — which is why it lives beside the grammar it belongs to and is exported.
 */
export const CLI_COLLECTION_VERBS: ReadonlySet<string> = new Set([
  "list",
  "search",
  "query",
  "versions",
  "list-runs",
  "records",
  "tag",
  "types",
]);

/**
 * CLI sub-resource verbs: rows are sub-entities (records, versions, events), not parent IDs.
 */
export const CLI_SUBRESOURCE_VERBS: ReadonlySet<string> = new Set([
  "records",
  "versions",
  "list-runs",
  "results",
  "tag",
  "tail",
  "ingestion-templates",
  "types",
]);

/**
 * Per-resource overrides for reference extraction (`extractDigest`), used only
 * where the convention defaults (`id`/`slug`/`<singular>_id`) miss the spelling
 * an endpoint actually uses. Most resources never need one.
 */
export interface ResourceRefHints {
  /** Id keys checked IN ORDER before the convention defaults. */
  idKeys?: readonly string[];
}

/** A resource's default card, and the verbs that deviate from it. */
interface ResourceCards {
  read: MeasuredCardKind;
  byVerb?: Record<string, MeasuredCardKind>;
  /** Reference-extraction hints for the digest (see `extractDigest`). */
  ref?: ResourceRefHints;
}

/**
 * Every resource the CLI exposes. Keyed by the resource word in
 * `langwatch <resource> <verb>`.
 */
export const CARDS_BY_RESOURCE: Record<string, ResourceCards> = {
  trace: {
    read: "traces",
    byVerb: { get: "trace" },
    // The traces API spells its id two ways at once (raw search document vs
    // serialisers); both beat the generic `id`, which a trace never carries.
    ref: { idKeys: ["trace_id", "traceId"] },
  },
  analytics: { read: "metrics" },
  annotation: { read: "resourceRead" },
  experiment: {
    read: "resourceRead",
    byVerb: { run: "evalRun", results: "evalRun", status: "evalRun" },
  },
  scenario: { read: "scenario", byVerb: { run: "evalRun" } },
  // `get` is the single-resource read these cards are for; `list` stays a
  // collection, which the generic rows card already draws well.
  evaluator: { read: "resourceRead", byVerb: { get: "evaluatorConfig" } },
  monitor: { read: "resourceRead", byVerb: { get: "evaluatorConfig" } },
  dashboard: { read: "resourceRead", byVerb: { get: "dashboard" } },
  graph: { read: "resourceRead", byVerb: { get: "dashboard" } },
  "virtual-keys": { read: "resourceRead", byVerb: { get: "spend" } },
  "simulation-run": { read: "evalRun" },
  suite: { read: "resourceRead", byVerb: { run: "evalRun" } },
  prompt: { read: "resourceRead" },
  agent: { read: "resourceRead", byVerb: { run: "evalRun" } },
  workflow: { read: "resourceRead", byVerb: { run: "evalRun" } },
  dataset: { read: "dataset", byVerb: { records: "dataset" } },
  trigger: { read: "resourceRead" },
  projects: { read: "resourceRead" },
  "api-keys": { read: "resourceRead" },
  "model-provider": { read: "resourceRead" },
  "model-default": { read: "resourceRead" },
  secret: { read: "resourceRead" },
  "gateway-budgets": { read: "resourceRead" },
  governance: { read: "resourceRead" },
  ingest: { read: "resourceRead" },
};

/**
 * The card a command's result renders in: a verb the resource names
 * explicitly wins, then the write grammar (`create` is a "created" card),
 * then the resource's default read card; an unknown resource reads generic.
 */
export const cardKindFor = ({
  resource,
  verb,
}: {
  resource: string;
  verb: string;
}): MeasuredCardKind => {
  const cards = CARDS_BY_RESOURCE[resource];

  const override = cards?.byVerb?.[verb];
  if (override) return override;

  const write = CARD_BY_WRITE_VERB[verb];
  if (write) return write;

  if (verb === "run") return "evalRun";

  return cards?.read ?? "resourceRead";
};

/** The schema that reads a command's result. */
export const cardSchemaFor = (command: { resource: string; verb: string }): z.ZodType =>
  SCHEMA_BY_CARD_KIND[cardKindFor(command)];

/** A CLI result, read into the card that draws it. */
export type ParsedCliResult =
  | { ok: true; kind: MeasuredCardKind; card: unknown }
  | { ok: false; kind: MeasuredCardKind; reason: string };

/**
 * Parse CLI JSON into its card; soft failures (ok: false) fall back to raw output.
 */
export const parseCliResult = ({
  resource,
  verb,
  output,
}: {
  resource: string;
  verb: string;
  output: unknown;
}): ParsedCliResult => parseCardResult({ kind: cardKindFor({ resource, verb }), output });

/**
 * Parse result into pre-decided card schema; re-deriving kind at render can mismatch (ADR-079).
 */
export const parseCardResult = ({
  kind,
  output,
}: {
  kind: MeasuredCardKind;
  output: unknown;
}): ParsedCliResult => {
  const document = asJsonDocument(output);

  if (document === null) {
    return { ok: false, kind, reason: "output is not a JSON document" };
  }

  const parsed = SCHEMA_BY_CARD_KIND[kind].safeParse(document);
  if (!parsed.success) {
    return { ok: false, kind, reason: parsed.error.message };
  }

  return { ok: true, kind, card: parsed.data };
};

/**
 * The JSON document behind a tool output — already parsed, or still the string it
 * was recorded as. Null when the output is not a document at all (a human table,
 * an error line, an empty stdout).
 */
export const asJsonDocument = (output: unknown): unknown => {
  if (output && typeof output === "object") return output;
  if (typeof output !== "string") return null;

  const trimmed = output.trim();
  const startsWithObject = trimmed.startsWith("{");
  const startsWithArray = trimmed.startsWith("[");
  if (!startsWithObject && !startsWithArray) return null;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
};
