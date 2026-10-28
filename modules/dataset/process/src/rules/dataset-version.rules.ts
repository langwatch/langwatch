/**
 * Pure rules of dataset versions: the content hash, the chunk arithmetic of a
 * stored version, the comparison of two contents and the retention tiers.
 * Spec: modules/dataset/specs/dataset-versioning.feature.
 */
import {
  DATASET_VERSION_COMPARE_LIST_MAX,
  type DatasetColumns,
  type DatasetVersionComparison,
  type DatasetVersionRow,
} from "@langwatch/dataset-contract";

/** Rows per stored version chunk, so a page of a version reads the chunks it covers only. */
export const DATASET_VERSION_ROWS_PER_CHUNK = 500;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
/** Every version younger than this is kept. */
export const DATASET_VERSION_KEEP_ALL_MS = DAY_MS;
/** Past the first day, one a day is kept until this age; past it, one a week. */
export const DATASET_VERSION_KEEP_DAILY_MS = DAY_MS + 30 * DAY_MS;
/** How long an archived dataset keeps its history, so an undone archive still has it. */
export const DATASET_VERSION_ARCHIVED_KEEP_MS = 30 * DAY_MS;
/** 1970-01-01 is a Thursday; weeks are counted from the Monday after it. */
const FIRST_MONDAY_MS = 4 * DAY_MS;

/** JSON with object keys sorted, so the same content always serialises the same way. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** The chunk indexes a page of a stored version covers. */
export function versionChunksOfPage({
  page,
  limit,
  rowCount,
}: {
  page: number;
  limit: number;
  rowCount: number;
}): { indexes: number[]; start: number; end: number } {
  const start = (page - 1) * limit;
  const end = Math.min(start + limit, rowCount);
  if (start >= end) return { indexes: [], start, end };
  const first = Math.floor(start / DATASET_VERSION_ROWS_PER_CHUNK);
  const last = Math.floor((end - 1) / DATASET_VERSION_ROWS_PER_CHUNK);
  return {
    indexes: Array.from({ length: last - first + 1 }, (_, offset) => first + offset),
    start,
    end,
  };
}

/** A stored line as a version row; a line written without an id is named by its position. */
export function versionRowOf(line: unknown, position: number): DatasetVersionRow {
  if (line !== null && typeof line === "object" && "entry" in line) {
    const { id, entry } = line as { id?: unknown; entry: unknown };
    return {
      id: typeof id === "string" && id.length > 0 ? id : `row-${position}`,
      entry: isRecord(entry) ? entry : {},
    };
  }
  return { id: `row-${position}`, entry: isRecord(line) ? line : {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A row list capped at the compare limit, with the full count beside it. */
type CappedRows<Row> = { count: number; listed: Row[] };

function capped<Row>(): CappedRows<Row> {
  return { count: 0, listed: [] };
}

function note<Row>(rows: CappedRows<Row>, row: Row): void {
  rows.count += 1;
  if (rows.listed.length < DATASET_VERSION_COMPARE_LIST_MAX) rows.listed.push(row);
}

/** Sorts each row of `after` into added, changed or unchanged against `before`. */
function sortAfterRows({
  beforeRows,
  afterRows,
}: {
  beforeRows: ReadonlyMap<string, DatasetVersionRow>;
  afterRows: readonly DatasetVersionRow[];
}) {
  const added = capped<DatasetVersionRow>();
  const changed = capped<DatasetVersionComparison["changed"][number]>();
  let unchanged = 0;
  for (const row of afterRows) {
    const previous = beforeRows.get(row.id);
    if (!previous) note(added, row);
    else if (stableStringify(previous.entry) === stableStringify(row.entry)) unchanged += 1;
    else note(changed, { id: row.id, before: previous.entry, after: row.entry });
  }
  return { added, changed, unchanged };
}

/** What changed from `before` (a version) to `after` (the current content). */
export function compareDatasetContents({
  version,
  before,
  after,
}: {
  version: number;
  before: { columns: DatasetColumns; rows: readonly DatasetVersionRow[] };
  after: { columns: DatasetColumns; rows: readonly DatasetVersionRow[] };
}): DatasetVersionComparison {
  const beforeNames = new Set(before.columns.map((column) => column.name));
  const afterNames = new Set(after.columns.map((column) => column.name));
  const afterIds = new Set(after.rows.map((row) => row.id));
  const { added, changed, unchanged } = sortAfterRows({
    beforeRows: new Map(before.rows.map((row) => [row.id, row])),
    afterRows: after.rows,
  });
  const removed = capped<DatasetVersionRow>();
  for (const row of before.rows) if (!afterIds.has(row.id)) note(removed, row);

  return {
    version,
    columns: {
      added: [...afterNames].filter((name) => !beforeNames.has(name)),
      removed: [...beforeNames].filter((name) => !afterNames.has(name)),
    },
    counts: { added: added.count, removed: removed.count, changed: changed.count, unchanged },
    added: added.listed,
    removed: removed.listed,
    changed: changed.listed,
    truncated: [added, removed, changed].some((rows) => rows.listed.length < rows.count),
  };
}

/** What the retention tiers read of one version. */
export type RetainableVersion = {
  id: string;
  createdAtMs: number;
  /** Named by hand, pinned by an experiment, or read by a run: never thinned. */
  protected: boolean;
};

/**
 * The versions retention removes: everything from the last day is kept, then
 * the newest of each UTC day for 30 days, then the newest of each week. The
 * latest version and every protected one are always kept.
 */
export function versionsToThin({
  versions,
  nowMs,
}: {
  versions: readonly RetainableVersion[];
  nowMs: number;
}): string[] {
  const newestFirst = versions.toSorted((left, right) => right.createdAtMs - left.createdAtMs);
  const seenBuckets = new Set<string>();
  const thinned: string[] = [];
  newestFirst.forEach((version, index) => {
    const tier = retentionTierOf({ createdAtMs: version.createdAtMs, nowMs });
    const bucket = tier.kind === "bucket" ? tier.bucket : null;
    const firstOfBucket = bucket !== null && !seenBuckets.has(bucket);
    if (bucket !== null) seenBuckets.add(bucket);
    const keep = index === 0 || version.protected || bucket === null || firstOfBucket;
    if (!keep) thinned.push(version.id);
  });
  return thinned;
}

/** Whether a version is young enough to keep whole, or the day or week it competes in. */
type RetentionTier = { kind: "keep_all" } | { kind: "bucket"; bucket: string };

function retentionTierOf({
  createdAtMs,
  nowMs,
}: {
  createdAtMs: number;
  nowMs: number;
}): RetentionTier {
  const age = nowMs - createdAtMs;
  if (age < DATASET_VERSION_KEEP_ALL_MS) return { kind: "keep_all" };
  if (age < DATASET_VERSION_KEEP_DAILY_MS) {
    return { kind: "bucket", bucket: `day:${Math.floor(createdAtMs / DAY_MS)}` };
  }
  return {
    kind: "bucket",
    bucket: `week:${Math.floor((createdAtMs - FIRST_MONDAY_MS) / WEEK_MS)}`,
  };
}
