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
import { SCHEMA_BY_CARD_KIND, type CardKind } from "./cards.js";

/** Verbs that write, and the card each writes into. */
const CARD_BY_WRITE_VERB: Record<string, CardKind> = {
  create: "resourceCreated",
  add: "resourceCreated",
  upload: "resourceCreated",
  init: "resourceCreated",
  update: "resourceUpdated",
  rename: "resourceUpdated",
  set: "resourceUpdated",
  assign: "resourceUpdated",
  restore: "resourceUpdated",
  duplicate: "resourceUpdated",
  sync: "promptDiff",
  push: "promptDiff",
  pull: "resourceUpdated",
  delete: "resourceRemoved",
  remove: "resourceRemoved",
  revoke: "resourceRemoved",
  archive: "resourceRemoved",
};

/** A resource's default card, and the verbs that deviate from it. */
interface ResourceCards {
  read: CardKind;
  byVerb?: Record<string, CardKind>;
}

/**
 * Every resource the CLI exposes. Keyed by the resource word in
 * `langwatch <resource> <verb>`.
 */
export const CARDS_BY_RESOURCE: Record<string, ResourceCards> = {
  trace: { read: "traces", byVerb: { get: "trace" } },
  analytics: { read: "metrics" },
  annotation: { read: "resourceRead" },
  experiment: {
    read: "resourceRead",
    byVerb: { run: "evalRun", results: "evalRun", status: "evalRun" },
  },
  monitor: { read: "resourceRead" },
  scenario: { read: "scenario", byVerb: { run: "evalRun" } },
  "simulation-run": { read: "evalRun" },
  suite: { read: "resourceRead", byVerb: { run: "evalRun" } },
  prompt: { read: "resourceRead" },
  agent: { read: "resourceRead", byVerb: { run: "evalRun" } },
  workflow: { read: "resourceRead", byVerb: { run: "evalRun" } },
  evaluator: { read: "resourceRead" },
  dataset: { read: "dataset", byVerb: { records: "dataset" } },
  dashboard: { read: "resourceRead" },
  graph: { read: "resourceRead" },
  trigger: { read: "resourceRead" },
  projects: { read: "resourceRead" },
  "api-keys": { read: "resourceRead" },
  "model-provider": { read: "resourceRead" },
  secret: { read: "resourceRead" },
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
}): ParsedCliResult => {
  const kind = cardKindFor({ resource, verb });
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
