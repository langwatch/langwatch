/**
 * Which card reads which CLI command — the registry that turns
 * `langwatch <resource> <verb>` into a schema.
 *
 * The resource's DEFAULT card covers its whole verb set, and only the verbs that
 * genuinely render differently are named. That is what keeps ~90 commands down to
 * a page of declarations: `dataset list`, `dataset get` and `dataset delete` all
 * read as the dataset resource, and only `trace get` needs to say it is a single
 * trace rather than a list of them.
 *
 * The verb GRAMMAR — create writes, delete destroys, run produces a run — is
 * classified once, so a new command inherits the right card without being listed
 * at all. A resource this registry has never heard of resolves to the generic
 * resource card rather than to nothing, because a card with fewer details still
 * beats a wall of console text.
 *
 * The resource list is the CLI's own, per `feature-map.json`.
 */
import type * as z from "zod/v4";
import {
  dashboardProbeSchema,
  evaluatorConfigProbeSchema,
  SCHEMA_BY_CARD_KIND,
  spendProbeSchema,
  timeseriesProbeSchema,
  type CardKind,
} from "./cards.js";

/**
 * ── SHAPE-DRIVEN PROMOTION ─────────────────────────────────────────────────
 *
 * `cardKindFor` picks a card from the command's NAME alone. That is right most
 * of the time and wrong in a specific, recurring way: a result can arrive full
 * of summable cost or a chartable series and still render as a generic table
 * because of what the command happened to be called. So the name stays a PRIOR
 * and the shape may PROMOTE.
 *
 * Rules that keep it honest, in order of how easily they are lost:
 *
 *  1. PROMOTE ONLY — never demote, never override a deliberate `byVerb`
 *     binding. Eligibility is decided by HOW the card was chosen, not by how
 *     generic it is: a resource's DEFAULT read card (`read:`) is a prior and
 *     may be promoted; a `byVerb` binding is a decision and may not. See
 *     `PROMOTABLE_FROM`.
 *  2. ELIGIBILITY THEN RANK, never first-match. An if-chain encodes its
 *     priority in source order, where nobody can see or test it. (Every
 *     serious visualisation-recommendation system ranks: Mackinlay's *Show Me*,
 *     UW's *Draco*.)
 *  3. TIES BREAK EXPLICITLY — two probes may not share a specificity, asserted
 *     by `promotion.test.ts`.
 *  4. PROBES MUST DISCRIMINATE, and a probe schema is NOT a card's render
 *     schema. Acceptance is a floor ("I can draw this"); evidence is a bar
 *     ("this payload proves it is mine"). Conflating them breaks a deliberate
 *     binding the moment a real payload omits a field.
 *
 * ADR: dev/docs/adr/059-card-selection-is-deterministic.md
 */

/**
 * The cards a result may be promoted FROM.
 *
 * The test is rule 1, not "is it generic": a card is promotable when it was
 * chosen by a resource DEFAULT rather than by a deliberate `byVerb` binding. So
 * the generic read qualifies, and so does `metrics` — the default the whole
 * `analytics` resource rides, which nothing ever chose for a specific verb.
 *
 * `metrics` matters because `analytics query` is the ONE command that answers
 * with a chartable series, and while it was excluded the timeseries card could
 * not be reached by any command in the product: "compare trace cost this week
 * to last" resolved to `metrics` and rendered the trend as two large decimals.
 *
 * A write card states what just happened and a bespoke `byVerb` read card was
 * chosen deliberately; neither is an invitation to guess again.
 */
const PROMOTABLE_FROM: ReadonlySet<CardKind> = new Set<CardKind>([
  "resourceRead",
  "metrics",
]);

export interface CardProbe {
  /** The card a payload matching `schema` is promoted to. */
  card: CardKind;
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
 * Assert that no two probes share a specificity, at module load.
 *
 * A duplicate would resolve by array order today and by a different array order
 * after the next edit, which is exactly the class of bug this module exists to
 * prevent. Failing at load makes it a five-second fix instead of a rendering
 * mystery.
 */
export function assertTotalOrder(probes: readonly CardProbe[]): void {
  const seen = new Map<number, CardKind>();
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
 * The best card a payload's SHAPE earns, or null to keep the one its name did.
 *
 * Null is the overwhelmingly common answer and the safe one: an unrecognised
 * shape keeps today's card, so growing this list can add richness but cannot
 * take any away.
 */
export function promoteCard({
  nominal,
  payload,
  probes,
}: {
  /** The card the command's name resolved to. */
  nominal: CardKind;
  payload: unknown;
  probes: readonly CardProbe[];
}): CardKind | null {
  if (!PROMOTABLE_FROM.has(nominal)) return null;

  let best: CardProbe | null = null;
  for (const probe of probes) {
    if (probe.card === nominal) continue;
    if (best && probe.specificity <= best.specificity) continue;
    if (!probe.schema.safeParse(payload).success) continue;
    best = probe;
  }
  return best?.card ?? null;
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
const CARD_BY_WRITE_VERB: Record<string, CardKind> = {
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
 * The tone a verb reads in: a create is `created`, a delete `removed`, a read
 * inert. This is CLI grammar, so a `sync` reads as `updated` here even though its
 * CARD is the prompt diff — tone and card answer different questions of the same
 * verb, and both stay in this one place rather than being re-derived per view.
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
 * CLI verbs whose result rows are SUB-entities of the resource, not the
 * resource itself — `dataset records` returns records, `prompt versions`
 * returns versions, `ingest tail` returns events. Their ids must never be
 * resolved as if they named the parent resource (a record id looked up as a
 * dataset would read as "dataset gone", which is a lie), so id-reference
 * hydration skips these and the card renders the stored structure instead.
 *
 * `types` is the same lie in its most misleading form: `evaluator types`
 * answers with the CATALOG an evaluator may be built from, and every row
 * carries a `slug` the convention would happily read as an evaluator id. Left
 * hydrating, a complete catalog resolves to nothing in the project and draws
 * as "no evaluators" — the empty-state card that command exists to prevent.
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
  read: CardKind;
  byVerb?: Record<string, CardKind>;
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
 * The card a command's result renders in.
 *
 * A verb the resource names explicitly wins; then the write grammar (a `create`
 * is a "created" card whatever it created); then the resource's default read
 * card. An unknown resource still gets the generic read card.
 */
export const cardKindFor = ({
  resource,
  verb,
}: {
  resource: string;
  verb: string;
}): CardKind => {
  const cards = CARDS_BY_RESOURCE[resource];

  const override = cards?.byVerb?.[verb];
  if (override) return override;

  const write = CARD_BY_WRITE_VERB[verb];
  if (write) return write;

  if (verb === "run") return "evalRun";

  return cards?.read ?? "resourceRead";
};

/** The schema that reads a command's result. */
export const cardSchemaFor = (command: {
  resource: string;
  verb: string;
}): z.ZodType => SCHEMA_BY_CARD_KIND[cardKindFor(command)];

/** A CLI result, read into the card that draws it. */
export type ParsedCliResult =
  | { ok: true; kind: CardKind; card: unknown }
  | { ok: false; kind: CardKind; reason: string };

/**
 * Read a CLI command's `--format json` output into its card.
 *
 * Accepts the document either parsed or as the JSON string the tool envelope
 * recorded it as, because the panel receives it as a string and the CLI holds it
 * as an object, and neither should have to care which.
 *
 * A result that does not match its card fails SOFTLY: the caller gets `ok:false`
 * and can fall back to raw output. A drifted response must degrade to "no card
 * detail", never to a wrong card and never to a crash.
 */
export const parseCliResult = ({
  resource,
  verb,
  output,
}: {
  resource: string;
  verb: string;
  output: unknown;
}): ParsedCliResult =>
  parseCardResult({ kind: cardKindFor({ resource, verb }), output });

/**
 * Read a result into the schema of a card that has ALREADY been decided.
 *
 * The panel's entry point. By the time anything renders, the card was chosen
 * once at the command boundary from the name and the payload together, and the
 * choice travels on the envelope — so re-deriving a kind from the command's
 * name at render time is a second decision that can disagree with the first.
 * It did: a promoted result parsed against the card its name would have earned
 * rather than the card it was stamped with. See ADR-059 §1.
 */
export const parseCardResult = ({
  kind,
  output,
}: {
  kind: CardKind;
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
export const asJsonDocument = (output: unknown): unknown | null => {
  if (output && typeof output === "object") return output;
  if (typeof output !== "string") return null;

  const trimmed = output.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
};
