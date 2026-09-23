/**
 * Result DIGEST: compact reference for the card to hydrate fresh data via API.
 */
import * as z from "zod";

import { parseCliJson } from "./cli-json.ts";
import { resolveTotal, type Pagination } from "./primitives.ts";
import { CARDS_BY_RESOURCE, cardKindFor } from "./registry.ts";

/** How many ids a digest carries at most — a reference, not an export. */
export const MAX_DIGEST_IDS = 25;

export const DIGEST_STRATEGIES = ["id-ref", "query-ref", "reduced", "text"] as const;

export type DigestStrategy = (typeof DIGEST_STRATEGIES)[number];

/**
 * The digest itself. Additive and optional everywhere it rides (tool parts,
 * final tool calls), so old turns and non-CLI tools render exactly as before.
 */
export const cliResultDigestSchema = z.object({
  resource: z.string().min(1),
  verb: z.string().min(1),
  strategy: z.enum(DIGEST_STRATEGIES),
  /** The ids the result surfaced, capped at {@link MAX_DIGEST_IDS}. */
  ids: z.array(z.string()).optional(),
  /** The one id a single-resource result is about. */
  primaryId: z.string().optional(),
  /** The resource's human name, when the result carried one. */
  name: z.string().optional(),
  /** The command's parsed flags — what the agent asked for. */
  query: z.record(z.string(), z.unknown()).optional(),
  counts: z
    .object({
      /** Rows the result actually returned (markers excluded). */
      returned: z.number().optional(),
      /** What the query matched in total, when the result reported it. */
      total: z.number().optional(),
    })
    .optional(),
  /** The structure-reduced document, for the `reduced` tier only. */
  reduced: z.unknown().optional(),
});

export type CliResultDigest = z.infer<typeof cliResultDigestSchema>;

/** Keys whose array value is the result list in a LangWatch JSON document. */
const COLLECTION_KEYS = ["traces", "data", "items", "results", "records"];

/** Human-name keys, in the order a reader would want them. */
const NAME_KEYS = ["name", "title", "label", "handle", "slug"];

/** Id spellings run-shaped results use, whatever the resource. */
const RUN_ID_KEYS = ["runId", "run_id", "batchRunId", "batch_run_id"];

/** `simulation-run` → `simulation_run_id` + `simulationRunId`. */
function singularIdKeys(resource: string): string[] {
  const words = resource.split("-").filter(Boolean);
  const snake = `${words.join("_")}_id`;
  const camel =
    words.map((word, i) => (i === 0 ? word : word[0]!.toUpperCase() + word.slice(1))).join("") +
    "Id";
  return [snake, camel];
}

/**
 * The id keys checked for a resource, in priority order: the resource's own
 * `ref` hint first, then the conventions every endpoint roughly follows.
 */
function idKeysFor({ resource, verb }: { resource: string; verb: string }): string[] {
  const hinted = CARDS_BY_RESOURCE[resource]?.ref?.idKeys ?? [];
  const runKeys = cardKindFor({ resource, verb }) === "evalRun" ? RUN_ID_KEYS : [];
  return [...hinted, "id", "slug", ...singularIdKeys(resource), ...runKeys];
}

function idOf(row: unknown, idKeys: string[]): string | undefined {
  if (!row || typeof row !== "object") return undefined;
  const record = row as Record<string, unknown>;
  for (const key of idKeys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function nameOf(document: unknown, omit?: string): string | undefined {
  if (!document || typeof document !== "object") return undefined;
  const record = document as Record<string, unknown>;
  for (const key of NAME_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim() && value !== omit) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * The document's array exactly as it holds it: a top-level array, or the first
 * recognised collection key, markers and all. `total` is counted from this,
 * because the reduction's marker is the only record of the rows it removed.
 */
function rawCollectionOf(document: unknown): unknown[] | null {
  if (Array.isArray(document)) return document;
  return document && typeof document === "object"
    ? (COLLECTION_KEYS.map((key) => (document as Record<string, unknown>)[key]).find(
        Array.isArray,
      ) ?? null)
    : null;
}

/** Only the rows that are results. `returned` counts these. */
function collectionRowsOf(document: unknown): unknown[] | null {
  const raw = rawCollectionOf(document);
  if (!raw) return null;
  return raw.filter((row) => !!row && typeof row === "object");
}

function paginationOf(document: unknown): Pagination | undefined {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return undefined;
  }
  const { pagination } = document as { pagination?: unknown };
  return pagination && typeof pagination === "object" ? (pagination as Pagination) : undefined;
}

/** The JSON document behind an output that may still carry console noise. */
function documentOf(output: unknown): unknown {
  if (output && typeof output === "object") return output;
  if (typeof output !== "string") return null;
  return parseCliJson(output);
}

/**
 * Extract digest for one CLI call: unreadable→text, unfetchable→reduced, analytics→query-ref.
 */
export function extractDigest({
  resource,
  verb,
  args,
  output,
}: {
  resource: string;
  verb: string;
  /** The command's parsed flags, carried as the digest's `query`. */
  args?: Record<string, unknown>;
  output: unknown;
}): CliResultDigest {
  const base = {
    resource,
    verb,
    ...(args && Object.keys(args).length > 0 ? { query: args } : {}),
  };

  const document = documentOf(output);
  if (document === null) {
    return { ...base, strategy: "text" };
  }

  // Aggregates re-run their query — rows would be stale numbers, not entities.
  if (cardKindFor({ resource, verb }) === "metrics") {
    return { ...base, strategy: "query-ref" };
  }

  const idKeys = idKeysFor({ resource, verb });
  const rows = collectionRowsOf(document);

  if (rows) {
    const ids = rows.map((row) => idOf(row, idKeys)).filter((id): id is string => id !== undefined);
    const counts = {
      returned: rows.length,
      total: resolveTotal({
        pagination: paginationOf(document),
        rows: rawCollectionOf(document) ?? rows,
      }),
    };
    if (ids.length === 0) {
      return { ...base, strategy: "reduced", counts, reduced: document };
    }
    return {
      ...base,
      strategy: "id-ref",
      ids: ids.slice(0, MAX_DIGEST_IDS),
      counts,
    };
  }

  const id = idOf(document, idKeys);
  const name = nameOf(document, id);
  if (id === undefined) {
    return {
      ...base,
      strategy: "reduced",
      ...(name !== undefined ? { name } : {}),
      reduced: document,
    };
  }
  return {
    ...base,
    strategy: "id-ref",
    ids: [id],
    primaryId: id,
    ...(name !== undefined ? { name } : {}),
    counts: { returned: 1 },
  };
}
