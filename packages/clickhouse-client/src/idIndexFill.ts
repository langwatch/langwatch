/**
 * The background fill of an owner's id indexes from rows older than their views (id-index plan
 * §3): per target, table and partition newest first, one `INSERT … SELECT` per (partition,
 * tenant range) batch, a cursor saved after each. Knows nothing of the upgrade system.
 */
import {
  assertIdentifier,
  type IdIndexTimeFormat,
  SHARED_CLICKHOUSE_TARGET,
} from "./idIndexFlags.ts";
import { writeIdIndexMarker } from "./idIndexReadiness.ts";
import type { QueryRequest, QueryResult } from "./query.ts";

/**
 * One index an owner fills, as its migration declares it. `retentionAnchor` is the column the
 * source expires on; when it is not `time`, the index carries it as `RetainAt`. `retention` is
 * `"copied"` from `_retention_days` (0 kept as 65535), or `"none"` for a source without it.
 */
export type IdIndexDeclaration = Readonly<{
  source: string;
  index: string;
  key: readonly string[];
  time: string;
  retentionAnchor: string;
  retention: "copied" | "none";
  filter?: string | undefined;
  /** How the source's `time` and the index's `FromAt`/`ToAt` are stored; `DateTime64` default. */
  timeFormat?: IdIndexTimeFormat | undefined;
}>;

/** `ExperimentId` as `experiment_id`: a key column as an index name spells it. */
function snakeCaseOf({ column }: { column: string }): string {
  return column
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/**
 * An id index's table name: `<source>_id_index` for a source's first, and `<source>_by_<key>_index`
 * for a second on other key columns (`experiment_runs_by_experiment_id_index`).
 */
export function idIndexName({
  source,
  key,
  by = false,
}: {
  source: string;
  key: readonly string[];
  by?: boolean | undefined;
}): string {
  if (!by) return `${source}_id_index`;
  return `${source}_by_${key.map((column) => snakeCaseOf({ column })).join("_")}_index`;
}

/**
 * Declares one id index the way its goose file creates it: named by `idIndexName`, expiring on
 * `time` and copying the source's `_retention_days` unless told otherwise.
 */
export function defineIdIndex({
  source,
  key,
  time,
  by,
  retentionAnchor = time,
  retention = "copied",
  filter,
  timeFormat,
}: {
  source: string;
  key: readonly string[];
  time: string;
  /** A source's second index, on other key columns: named `<source>_by_<key>_index`. */
  by?: true | undefined;
  retentionAnchor?: string | undefined;
  retention?: "copied" | "none" | undefined;
  filter?: string | undefined;
  timeFormat?: IdIndexTimeFormat | undefined;
}): IdIndexDeclaration {
  if (key.length === 0) throw new Error(`The id index over ${source} names no key column.`);
  return {
    source: assertIdentifier({ name: source }),
    index: idIndexName({ source, key, by }),
    key: key.map((column) => assertIdentifier({ name: column })),
    time: assertIdentifier({ name: time }),
    retentionAnchor: assertIdentifier({ name: retentionAnchor }),
    retention,
    ...(filter === undefined ? {} : { filter }),
    ...(timeFormat === undefined ? {} : { timeFormat }),
  };
}

/** A ClickHouse server the fill visits: one per URL; its markers serve each organisation on it. */
export type IdIndexFillTarget = Readonly<{
  /** `"shared"`, or the first organisation on the URL; never the URL, which may hold a secret. */
  key: string;
  /** Routes the statements; absent for the shared target. */
  organizationId?: string | undefined;
}>;

/** Where the fill sends its statements: the routed client, under `SKIP_TENANT_CHECK`. */
export interface IdIndexStatements {
  query<Row>(request: QueryRequest): Promise<QueryResult<Row>>;
  command(request: QueryRequest): Promise<void>;
}

/** The step's checkpoint, structurally: the last saved report, and the save. */
export interface IdIndexFillCheckpoint {
  readonly resumeFrom: Readonly<Record<string, unknown>> | null;
  save(args: { report: IdIndexFillReport }): Promise<void>;
}

/**
 * The last committed batch. A whole-partition batch has no upper tenant bound; `throughKey` is
 * set while a tenant split by key range is part way, and absent once all of it is committed.
 */
export type IdIndexFillCursor = {
  target: string;
  table: string;
  partition: string;
  afterTenantId: string;
  throughTenantId: string | null;
  slice: number;
  slices: number;
  throughKey?: string[] | undefined;
  /** The partition is filled and already counted in `done`; a resumed walk moves past it. */
  complete?: true | undefined;
};

/** The step's report, replaced whole on each save; `done`/`total` count partitions. */
export type IdIndexFillReport = {
  targetsDone: string[];
  /** Targets whose partitions `total` already counts, so a retried target is counted once. */
  targetsCounted: string[];
  targetsFailed: { target: string; error: string }[];
  cursor: IdIndexFillCursor | null;
  done: number;
  total: number;
  batches: number;
  retries: number;
  dryRun?: { partitions: number; rows: number } | undefined;
};

export type FillIdIndexesOptions = {
  statements: IdIndexStatements;
  targets: readonly IdIndexFillTarget[];
  indexes: readonly IdIndexDeclaration[];
  checkpoint: IdIndexFillCheckpoint;
  signal: AbortSignal;
  dryRun?: boolean | undefined;
  /** Source rows per batch; a larger partition is split by tenant range. */
  batchRows?: number | undefined;
  /** The floor a memory or timeout error halves the batch down to, before the target fails. */
  minBatchRows?: number | undefined;
  /** Runs once a target is filled, before its marker rows: the retention raise. */
  beforeMarker: (input: { target: IdIndexFillTarget }) => Promise<void>;
  /** The pause between retries; a timer by default. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
};

export const DEFAULT_ID_INDEX_BATCH_ROWS = 5_000_000;
const MIN_ID_INDEX_BATCH_ROWS = 250_000;
/** A partition with parts on the cold volume starts at a quarter of the batch: S3 reads slower. */
const COLD_BATCH_DIVISOR = 4;
const MAX_BATCH_RETRIES = 5;
const FIRST_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const MEMORY_LIMIT_EXCEEDED = "241";
const TIMEOUT_EXCEEDED = "159";

const FILL_SETTINGS = {
  optimize_aggregation_in_order: 1,
  max_threads: 4,
  max_execution_time: 600,
  max_bytes_before_external_group_by: 2_000_000_000,
} as const;

/**
 * One batch of one partition: a tenant range; for a tenant above the size, either a hash slice
 * of it or (`byKey`, where the key leads the source's sort key) its rows in key ranges.
 */
type Batch = Pick<IdIndexFillCursor, "afterTenantId" | "throughTenantId" | "slice" | "slices"> & {
  byKey?: true | undefined;
};

/** How a tenant above the batch size is split: key ranges read each row once, hash slices not. */
export type IdIndexTenantSplit = "key" | "hash";

/** One `byKey` batch's key range: after the last committed key, through the next boundary. */
export type IdIndexKeyRange = {
  after: readonly string[] | null;
  through: readonly string[] | null;
};

type Partition = { partition: string; rows: number; cold?: boolean | undefined };

/** `shared` first, then one target per private URL, keyed and routed by its first organisation. */
export function idIndexFillTargets({
  privateRoutes,
}: {
  privateRoutes: ReadonlyMap<string, string>;
}): IdIndexFillTarget[] {
  const byUrl = new Map<string, string[]>();
  for (const [organizationId, url] of privateRoutes) {
    byUrl.set(url, [...(byUrl.get(url) ?? []), organizationId]);
  }
  const routed = [...byUrl.values()]
    .map((organizations) => organizations.toSorted())
    .flatMap(([first]) => (first === undefined ? [] : [{ key: first, organizationId: first }]))
    .toSorted((left, right) => left.key.localeCompare(right.key));
  return [{ key: SHARED_CLICKHOUSE_TARGET }, ...routed];
}

/** Packs a partition's tenants, in order, into ranges of about `batchRows` source rows. */
export function planBatches({
  partition,
  tenants,
  batchRows,
  split = "hash",
}: {
  partition: Partition;
  tenants: readonly { tenantId: string; rows: number }[] | null;
  batchRows: number;
  split?: IdIndexTenantSplit;
}): Batch[] {
  if (tenants === null || partition.rows <= batchRows) {
    return [{ afterTenantId: "", throughTenantId: null, slice: 0, slices: 1 }];
  }
  const packer = new TenantPacker({ batchRows, split });
  for (const tenant of tenants) packer.add(tenant);
  return packer.finish();
}

/** Consecutive tenants share a range; a tenant above the size is split on its own. */
class TenantPacker {
  private readonly batches: Batch[] = [];
  private after = "";
  private pending = 0;
  private last: string | undefined;
  private readonly batchRows: number;
  private readonly split: IdIndexTenantSplit;

  constructor({ batchRows, split }: { batchRows: number; split: IdIndexTenantSplit }) {
    this.batchRows = batchRows;
    this.split = split;
  }

  add({ tenantId, rows }: { tenantId: string; rows: number }): void {
    if (rows > this.batchRows) {
      this.slice({ tenantId, rows });
      return;
    }
    if (this.pending + rows > this.batchRows) this.close();
    this.pending += rows;
    this.last = tenantId;
  }

  finish(): Batch[] {
    this.close();
    return this.batches;
  }

  private slice({ tenantId, rows }: { tenantId: string; rows: number }): void {
    this.close();
    if (this.split === "key") {
      this.batches.push({
        afterTenantId: this.after,
        throughTenantId: tenantId,
        slice: 0,
        slices: 1,
        byKey: true,
      });
      this.after = tenantId;
      this.last = tenantId;
      return;
    }
    const slices = Math.ceil(rows / this.batchRows);
    for (let slice = 0; slice < slices; slice += 1) {
      this.batches.push({ afterTenantId: this.after, throughTenantId: tenantId, slice, slices });
    }
    this.after = tenantId;
    this.last = tenantId;
  }

  private close(): void {
    if (this.last === undefined || this.pending === 0) return;
    this.batches.push({
      afterTenantId: this.after,
      throughTenantId: this.last,
      slice: 0,
      slices: 1,
    });
    this.after = this.last;
    this.pending = 0;
  }
}

/**
 * Whether `batch` was committed at or before `cursor` in the same partition's walk. A key-split
 * tenant is committed once its last range is; a cursor from the other split redoes the tenant,
 * which changes no range (`min`/`max` merge).
 */
function isCommitted({ batch, cursor }: { batch: Batch; cursor: IdIndexFillCursor }): boolean {
  if (cursor.throughTenantId === null) return true;
  if (batch.throughTenantId === null) return false;
  if (batch.throughTenantId !== cursor.throughTenantId) {
    return batch.throughTenantId < cursor.throughTenantId;
  }
  if (batch.byKey === true) return cursor.slices === 1 && cursor.throughKey === undefined;
  return (
    cursor.throughKey === undefined && batch.slices === cursor.slices && batch.slice <= cursor.slice
  );
}

/** Where a key-split tenant resumes: after the last key its cursor committed, else its start. */
function resumeKeyOf({
  batch,
  cursor,
}: {
  batch: Batch;
  cursor: IdIndexFillCursor | null;
}): readonly string[] | null {
  if (cursor === null || cursor.throughTenantId !== batch.throughTenantId) return null;
  return cursor.throughKey ?? null;
}

/**
 * The lexicographic comparison of the key columns with bound values, spelt column by column so
 * the primary index prunes on it: `>` past `after`, `<=` up to `through`.
 */
function keyComparison({
  key,
  values,
  op,
  param,
}: {
  key: readonly string[];
  values: readonly string[];
  op: ">" | "<=";
  param: string;
}): { sql: string; params: Record<string, unknown> } {
  if (values.length !== key.length) {
    throw new Error(`A key range names ${values.length} values for ${key.length} key columns.`);
  }
  const params: Record<string, unknown> = {};
  const slot = (position: number) => `{${param}${position}:String}`;
  key.forEach((_column, position) => {
    params[`${param}${position}`] = values[position];
  });
  const strict = op === ">" ? ">" : "<";
  const branches = key.map((column, position) => {
    const equal = key.slice(0, position).map((prefix, at) => `${prefix} = ${slot(at)}`);
    const last = position === key.length - 1 && op === "<=" ? "<=" : strict;
    return [...equal, `${column} ${last} ${slot(position)}`].join(" AND ");
  });
  return { sql: `(${branches.map((branch) => `(${branch})`).join(" OR ")})`, params };
}

/** A batch's partition and tenant predicate, and for a key-split tenant its key range. */
function batchRange({
  key,
  batch,
  keyRange,
}: {
  key: readonly string[];
  batch: Batch;
  keyRange: IdIndexKeyRange | undefined;
}): { where: string[]; params: Record<string, unknown> } {
  const where = ["_partition_id = {partition:String}"];
  const params: Record<string, unknown> = {};
  if (keyRange === undefined || batch.throughTenantId === null) {
    where.push("TenantId > {afterTenantId:String}");
    params.afterTenantId = batch.afterTenantId;
    if (batch.throughTenantId !== null) {
      where.push("TenantId <= {throughTenantId:String}");
      params.throughTenantId = batch.throughTenantId;
    }
    return { where, params };
  }
  where.push("TenantId = {throughTenantId:String}");
  params.throughTenantId = batch.throughTenantId;
  const ranges = [
    { values: keyRange.after, op: ">" as const, param: "afterKey" },
    { values: keyRange.through, op: "<=" as const, param: "throughKey" },
  ];
  for (const { values, op, param } of ranges) {
    if (values === null) continue;
    const comparison = keyComparison({ key, values, op, param });
    where.push(comparison.sql);
    Object.assign(params, comparison.params);
  }
  return { where, params };
}

/** The cursor a committed batch leaves; a key range not yet at its tenant's end keeps its key. */
function cursorAfter({
  target,
  index,
  partition,
  batch,
  keyRange,
}: {
  target: IdIndexFillTarget;
  index: IdIndexDeclaration;
  partition: Partition;
  batch: Batch;
  keyRange: IdIndexKeyRange | undefined;
}): IdIndexFillCursor {
  const through = keyRange?.through ?? null;
  return {
    target: target.key,
    table: index.index,
    partition: partition.partition,
    afterTenantId: batch.afterTenantId,
    throughTenantId: batch.throughTenantId,
    slice: batch.slice,
    slices: batch.slices,
    ...(through === null ? {} : { throughKey: [...through] }),
  };
}

/** The `INSERT … SELECT` one batch runs: the index rows of its tenants in one partition. */
export function fillStatement({
  index,
  batch,
  keyRange,
}: {
  index: IdIndexDeclaration;
  batch: Batch;
  keyRange?: IdIndexKeyRange | undefined;
}): {
  sql: string;
  params: Record<string, unknown>;
} {
  const name = (column: string) => assertIdentifier({ name: column });
  const key = index.key.map(name);
  const lastKey = key.at(-1);
  if (lastKey === undefined) throw new Error(`${index.index} declares no key column.`);
  const time = name(index.time);
  const retainAt = index.retentionAnchor === index.time ? undefined : name(index.retentionAnchor);
  const retention =
    index.retention === "copied"
      ? "if(_retention_days = 0, 65535, _retention_days)"
      : "toUInt16(65535)";
  const columns = ["TenantId", ...key, "FromAt", "ToAt"];
  const selected = ["TenantId", ...key, `min(${time}) AS FromAt`, `max(${time}) AS ToAt`];
  if (retainAt !== undefined) {
    columns.push("RetainAt");
    selected.push(`max(${retainAt}) AS RetainAt`);
  }
  columns.push("_retention_days");
  selected.push(`max(${retention}) AS _retention_days`);
  const { where, params } = batchRange({ key, batch, keyRange });
  if (batch.slices > 1) {
    where.push(`cityHash64(${lastKey}) % {slices:UInt32} = {slice:UInt32}`);
    params.slices = batch.slices;
    params.slice = batch.slice;
  }
  if (index.filter !== undefined) where.push(`(${index.filter})`);
  const sql =
    `INSERT INTO ${name(index.index)} (${columns.join(", ")}) ` +
    `SELECT ${selected.join(", ")} FROM ${name(index.source)} ` +
    `WHERE ${where.join(" AND ")} GROUP BY ${["TenantId", ...key].join(", ")}`;
  return { sql, params };
}

/** Whether a `system.tables.sorting_key` (`TenantId, TraceId, SpanId`) starts with `columns`. */
export function sortKeyLeadsWith({
  sortingKey,
  columns,
}: {
  sortingKey: string;
  columns: readonly string[];
}): boolean {
  const sorted = sortingKey.split(",").map((column) => column.trim());
  return columns.every((column, position) => sorted[position] === column);
}

const timer = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A memory limit (241) or a timeout (159, or the driver's own): a smaller batch may pass. */
function isBatchTooLarge(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = String(Reflect.get(error, "code"));
  const message = messageOf(error);
  return (
    code === MEMORY_LIMIT_EXCEEDED ||
    code === TIMEOUT_EXCEEDED ||
    message.includes("MEMORY_LIMIT_EXCEEDED") ||
    message.includes("TIMEOUT_EXCEEDED") ||
    message.startsWith("Code: 159.") ||
    Reflect.get(error, "name") === "TimeoutError" ||
    /^timeout error\.?$/i.test(message.trim())
  );
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((each) => typeof each === "string") : [];
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

function cursorOf(value: unknown): IdIndexFillCursor | null {
  if (typeof value !== "object" || value === null) return null;
  const field = (name: string): unknown => Reflect.get(value, name);
  const target = stringOf(field("target"));
  const table = stringOf(field("table"));
  const partition = stringOf(field("partition"));
  const afterTenantId = stringOf(field("afterTenantId"));
  const through = field("throughTenantId");
  const throughTenantId = through === null ? null : stringOf(through);
  if (target === undefined || table === undefined) return null;
  if (partition === undefined || afterTenantId === undefined || throughTenantId === undefined) {
    return null;
  }
  const throughKey = stringsOf(field("throughKey"));
  return {
    target,
    table,
    partition,
    afterTenantId,
    throughTenantId,
    slice: numberOf(field("slice")),
    slices: Math.max(1, numberOf(field("slices"))),
    ...(throughKey.length === 0 ? {} : { throughKey }),
    ...(field("complete") === true ? { complete: true as const } : {}),
  };
}

/** The saved report, read back field by field; a first run, or an unreadable one, starts empty. */
export function fillReportOf({
  resumeFrom,
}: {
  resumeFrom: Readonly<Record<string, unknown>> | null;
}): IdIndexFillReport {
  return {
    targetsDone: stringsOf(resumeFrom?.targetsDone),
    targetsCounted: stringsOf(resumeFrom?.targetsCounted),
    // A failed target is unfinished: every run tries it again.
    targetsFailed: [],
    cursor: cursorOf(resumeFrom?.cursor),
    done: numberOf(resumeFrom?.done),
    total: numberOf(resumeFrom?.total),
    batches: numberOf(resumeFrom?.batches),
    retries: numberOf(resumeFrom?.retries),
  };
}

/** Thrown at the end of a walk that left a target unfilled; the ledger's retry resumes it. */
export class IdIndexFillIncompleteError extends Error {
  constructor(readonly failed: readonly { target: string; error: string }[]) {
    super(
      `Id index fill left ${failed.length} target(s) unfilled: ${failed.map((each) => each.target).join(", ")}.`,
    );
    this.name = "IdIndexFillIncompleteError";
  }
}

/**
 * Fills every declared index on every target, then raises its retention and writes its markers.
 * Level-triggered: re-running changes no range (`min`/`max` merge), and a restart resumes at
 * the cursor. A failed target is recorded, the others carry on, and the walk throws at the end.
 */
export async function fillIdIndexes(options: FillIdIndexesOptions): Promise<IdIndexFillReport> {
  const walk = new IdIndexFill(options);
  return walk.run();
}

class IdIndexFill {
  private readonly report: IdIndexFillReport;
  private readonly batchRows: number;
  private readonly minBatchRows: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: FillIdIndexesOptions) {
    this.report = fillReportOf({ resumeFrom: options.checkpoint.resumeFrom });
    this.batchRows = options.batchRows ?? DEFAULT_ID_INDEX_BATCH_ROWS;
    this.minBatchRows = Math.min(this.batchRows, options.minBatchRows ?? MIN_ID_INDEX_BATCH_ROWS);
    this.sleep = options.sleep ?? timer;
  }

  async run(): Promise<IdIndexFillReport> {
    if (this.options.dryRun === true) return this.estimate();
    for (const target of this.options.targets) {
      if (this.options.signal.aborted) return this.report;
      if (this.report.targetsDone.includes(target.key)) continue;
      try {
        const finished = await this.fillTarget(target);
        if (!finished) return this.report;
        await this.options.beforeMarker({ target });
        for (const table of this.options.indexes) {
          await writeIdIndexMarker({
            statements: this.options.statements,
            route: this.route(target),
            table,
          });
        }
        this.report.targetsDone.push(target.key);
        this.report.cursor = null;
        await this.save();
      } catch (error) {
        this.report.targetsFailed.push({ target: target.key, error: messageOf(error) });
        await this.save();
      }
    }
    if (this.report.targetsFailed.length > 0) {
      throw new IdIndexFillIncompleteError(this.report.targetsFailed);
    }
    return this.report;
  }

  /** Partitions and rows the fill would read, with nothing written or marked. */
  private async estimate(): Promise<IdIndexFillReport> {
    let partitions = 0;
    let rows = 0;
    for (const target of this.options.targets) {
      for (const index of this.options.indexes) {
        for (const partition of await this.partitionsOf({ target, index })) {
          partitions += 1;
          rows += partition.rows;
        }
      }
    }
    return { ...this.report, dryRun: { partitions, rows } };
  }

  /** False when the walk was aborted part way; the cursor holds where it stopped. */
  private async fillTarget(target: IdIndexFillTarget): Promise<boolean> {
    const cursor = this.report.cursor?.target === target.key ? this.report.cursor : null;
    const tableAt =
      cursor === null ? -1 : this.options.indexes.findIndex((each) => each.index === cursor.table);
    const listed = await Promise.all(
      this.options.indexes.map(async (index) => ({
        index,
        partitions: await this.partitionsOf({ target, index }),
      })),
    );
    // A resumed cursor was counted when its target started, before the report kept the list.
    if (!this.report.targetsCounted.includes(target.key)) {
      if (cursor === null) {
        this.report.total += listed.reduce((sum, each) => sum + each.partitions.length, 0);
      }
      this.report.targetsCounted.push(target.key);
    }
    for (const [position, { index, partitions }] of listed.entries()) {
      if (position < tableAt) continue;
      const resumed = position === tableAt ? cursor : null;
      if (!(await this.fillTable({ target, index, partitions, resumed }))) return false;
    }
    return true;
  }

  /** One table's partitions newest first, skipping those a resumed cursor already passed. */
  private async fillTable({
    target,
    index,
    partitions,
    resumed,
  }: {
    target: IdIndexFillTarget;
    index: IdIndexDeclaration;
    partitions: readonly Partition[];
    resumed: IdIndexFillCursor | null;
  }): Promise<boolean> {
    for (const partition of partitions) {
      if (resumed !== null && partition.partition > resumed.partition) continue;
      if (this.options.signal.aborted) return false;
      const cursor = resumed?.partition === partition.partition ? resumed : null;
      if (cursor?.complete === true) continue;
      if (!(await this.fillPartition({ target, index, partition, cursor }))) return false;
      this.report.done += 1;
      // Saved together with `done`, so a walk stopped before the next partition
      // never counts this one twice.
      const last = this.report.cursor;
      if (
        last !== null &&
        last.target === target.key &&
        last.table === index.index &&
        last.partition === partition.partition
      ) {
        this.report.cursor = { ...last, complete: true };
      }
    }
    return true;
  }

  private async fillPartition({
    target,
    index,
    partition,
    cursor,
  }: {
    target: IdIndexFillTarget;
    index: IdIndexDeclaration;
    partition: Partition;
    cursor: IdIndexFillCursor | null;
  }): Promise<boolean> {
    let batchRows = partition.cold
      ? Math.max(this.minBatchRows, Math.ceil(this.batchRows / COLD_BATCH_DIVISOR))
      : this.batchRows;
    let sizing: {
      tenants: { tenantId: string; rows: number }[];
      split: IdIndexTenantSplit;
    } | null = null;
    let committed = cursor;
    let failures = 0;
    for (;;) {
      if (partition.rows > batchRows && sizing === null) {
        sizing = await this.sizingOf({ target, index, partition });
      }
      const next = planBatches({
        partition,
        tenants: sizing?.tenants ?? null,
        batchRows,
        split: sizing?.split,
      }).find((batch) => committed === null || !isCommitted({ batch, cursor: committed }));
      if (next === undefined) return true;
      if (this.options.signal.aborted) return false;
      const keyRange = await this.keyRangeOf({
        target,
        index,
        partition,
        batch: next,
        committed,
        batchRows,
      });
      const attempt = await this.insertBatch({ target, index, partition, batch: next, keyRange });
      if (!attempt.ok) {
        const smaller = this.smallerBatch({ error: attempt.error, batchRows });
        // A halved batch is a fresh attempt; retries run out only at the floor.
        failures = smaller < batchRows ? 1 : failures + 1;
        batchRows = smaller;
        await this.backOff({ error: attempt.error, failures });
        continue;
      }
      committed = cursorAfter({ target, index, partition, batch: next, keyRange });
      this.report.cursor = committed;
      this.report.batches += 1;
      failures = 0;
      // Outside the retry: a save refused for a lost lease must stop the walk, not be retried.
      await this.save();
    }
  }

  private async insertBatch({
    target,
    index,
    partition,
    batch,
    keyRange,
  }: {
    target: IdIndexFillTarget;
    index: IdIndexDeclaration;
    partition: Partition;
    batch: Batch;
    keyRange: IdIndexKeyRange | undefined;
  }): Promise<{ ok: true } | { ok: false; error: unknown }> {
    const statement = fillStatement({ index, batch, keyRange });
    try {
      await this.options.statements.command({
        ...this.route(target),
        sql: statement.sql,
        params: { ...statement.params, partition: partition.partition },
        table: index.index,
        kind: "write",
        settings: FILL_SETTINGS,
        // A fill reads every tenant's rows of one partition; the index keeps each tenant's own.
        SKIP_TENANT_CHECK: true,
        // The fill walks every partition by design, cold ones included, once each.
        SKIP_COLD_SCAN_CHECK: true,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /** Half the batch, down to the floor, after a memory or timeout error; else unchanged. */
  private smallerBatch({ error, batchRows }: { error: unknown; batchRows: number }): number {
    if (!isBatchTooLarge(error)) return batchRows;
    return Math.max(this.minBatchRows, Math.ceil(batchRows / 2));
  }

  /** Pauses 1 s doubling to 30 s; past the retries the target fails and the walk moves on. */
  private async backOff({ error, failures }: { error: unknown; failures: number }): Promise<void> {
    this.report.retries += 1;
    if (failures > MAX_BATCH_RETRIES) throw error;
    await this.sleep(Math.min(MAX_BACKOFF_MS, FIRST_BACKOFF_MS * 2 ** (failures - 1)));
  }

  private route(target: IdIndexFillTarget): Pick<QueryRequest, "tenantId" | "organizationId"> {
    return target.organizationId === undefined
      ? { tenantId: "" }
      : { tenantId: "", organizationId: target.organizationId };
  }

  private async partitionsOf({
    target,
    index,
  }: {
    target: IdIndexFillTarget;
    index: IdIndexDeclaration;
  }): Promise<Partition[]> {
    const result = await this.options.statements.query<{
      partition_id: string;
      rows: string | number;
      cold?: string | number | undefined;
    }>({
      ...this.route(target),
      sql:
        "SELECT partition_id, sum(rows) AS rows, max(disk_name IN (" +
        "SELECT arrayJoin(disks) FROM system.storage_policies WHERE volume_name = 'cold'" +
        ")) AS cold FROM system.parts " +
        "WHERE database = currentDatabase() AND table = {source:String} AND active " +
        "GROUP BY partition_id ORDER BY partition_id DESC",
      params: { source: assertIdentifier({ name: index.source }) },
      table: "system.parts",
      // The part list describes the server, which no tenant owns.
      SKIP_TENANT_CHECK: true,
    });
    return result.rows.map((row) => ({
      partition: row.partition_id,
      rows: Number(row.rows),
      cold: Number(row.cold ?? 0) > 0,
    }));
  }

  /** A partition's tenants by row count, and how one above the batch size is split. */
  private async sizingOf({
    target,
    index,
    partition,
  }: {
    target: IdIndexFillTarget;
    index: IdIndexDeclaration;
    partition: Partition;
  }): Promise<{ tenants: { tenantId: string; rows: number }[]; split: IdIndexTenantSplit }> {
    const tenants = await this.tenantsOf({ target, index, partition });
    return { tenants, split: await this.splitOf({ target, index }) };
  }

  /** The key range a `byKey` batch reads next, resuming after its cursor; none for the others. */
  private async keyRangeOf({
    target,
    index,
    partition,
    batch,
    committed,
    batchRows,
  }: {
    target: IdIndexFillTarget;
    index: IdIndexDeclaration;
    partition: Partition;
    batch: Batch;
    committed: IdIndexFillCursor | null;
    batchRows: number;
  }): Promise<IdIndexKeyRange | undefined> {
    if (batch.byKey !== true) return undefined;
    const after = resumeKeyOf({ batch, cursor: committed });
    return this.nextKeyRange({ target, index, partition, batch, after, batchRows });
  }

  /** Key ranges where the key leads the source's sort key after `TenantId`; hash slices else. */
  private async splitOf({
    target,
    index,
  }: {
    target: IdIndexFillTarget;
    index: IdIndexDeclaration;
  }): Promise<IdIndexTenantSplit> {
    const result = await this.options.statements.query<{ sorting_key?: unknown }>({
      ...this.route(target),
      sql:
        "SELECT sorting_key FROM system.tables " +
        "WHERE database = currentDatabase() AND name = {source:String}",
      params: { source: assertIdentifier({ name: index.source }) },
      table: "system.tables",
      // The table list describes the server, which no tenant owns.
      SKIP_TENANT_CHECK: true,
    });
    const sortingKey = result.rows[0]?.sorting_key;
    return typeof sortingKey === "string" &&
      sortKeyLeadsWith({ sortingKey, columns: ["TenantId", ...index.key] })
      ? "key"
      : "hash";
  }

  /**
   * The next key range of a key-split tenant: after the last committed key, through the key
   * `batchRows` rows on, read in sort order so only the key column of those rows is read. The
   * last range is open: fewer than `batchRows` rows remain.
   */
  private async nextKeyRange({
    target,
    index,
    partition,
    batch,
    after,
    batchRows,
  }: {
    target: IdIndexFillTarget;
    index: IdIndexDeclaration;
    partition: Partition;
    batch: Batch;
    after: readonly string[] | null;
    batchRows: number;
  }): Promise<IdIndexKeyRange> {
    const key = index.key.map((column) => assertIdentifier({ name: column }));
    const where = ["_partition_id = {partition:String}", "TenantId = {tenantId:String}"];
    const params: Record<string, unknown> = {
      partition: partition.partition,
      tenantId: batch.throughTenantId,
    };
    if (after !== null) {
      const comparison = keyComparison({ key, values: after, op: ">", param: "afterKey" });
      where.push(comparison.sql);
      Object.assign(params, comparison.params);
    }
    const result = await this.options.statements.query<Record<string, unknown>>({
      ...this.route(target),
      sql:
        `SELECT ${key.join(", ")} FROM ${assertIdentifier({ name: index.source })} ` +
        `WHERE ${where.join(" AND ")} ORDER BY ${key.join(", ")} LIMIT 1 OFFSET ${Math.max(0, Math.floor(batchRows) - 1)}`,
      params,
      table: index.source,
      // Sizes one tenant's next batch in a partition the fill reads for every tenant anyway.
      SKIP_TENANT_CHECK: true,
      // One partition's rows, named by its id rather than by time.
      SKIP_COLD_SCAN_CHECK: true,
    });
    const [row] = result.rows;
    if (row === undefined) return { after, through: null };
    const through = key.map((column) => {
      const value = row[column];
      return typeof value === "string" ? value : "";
    });
    return { after, through };
  }

  private async tenantsOf({
    target,
    index,
    partition,
  }: {
    target: IdIndexFillTarget;
    index: IdIndexDeclaration;
    partition: Partition;
  }): Promise<{ tenantId: string; rows: number }[]> {
    const result = await this.options.statements.query<{ TenantId: string; rows: string | number }>(
      {
        ...this.route(target),
        sql:
          `SELECT TenantId, count() AS rows FROM ${assertIdentifier({ name: index.source })} ` +
          "WHERE _partition_id = {partition:String} GROUP BY TenantId ORDER BY TenantId",
        params: { partition: partition.partition },
        table: index.source,
        // Sizing the batches counts every tenant's rows in the partition; nothing is returned.
        SKIP_TENANT_CHECK: true,
        // One partition's sorted TenantId column, named by its id rather than by time.
        SKIP_COLD_SCAN_CHECK: true,
      },
    );
    return result.rows.map((row) => ({ tenantId: row.TenantId, rows: Number(row.rows) }));
  }

  private save(): Promise<void> {
    return this.options.checkpoint.save({ report: this.report });
  }
}

/** Raises one target's index rows to each tenant's retention: data-retention's operation. */
export type IdIndexRetentionRaise = (input: {
  organizationId?: string;
  indexes: string[];
}) => Promise<unknown>;

/** What an owner's fill takes from its step; the owner's repository supplies the rest. */
export type IdIndexOwnerFill = Pick<FillIdIndexesOptions, "checkpoint" | "signal" | "dryRun"> & {
  /** Runs per target once it is filled, before its marker rows, over the indexes that copy it. */
  raiseRetention: IdIndexRetentionRaise;
};

/** The routed client an owner fills through: its statements, and the private routes it visits. */
export type IdIndexFillClient = IdIndexStatements & {
  privateRoutes(): ReadonlyMap<string, string>;
};

/** One owner's fill over its declared indexes on every target, retention raised before markers. */
export function fillOwnerIdIndexes({
  clickhouse,
  indexes,
  raiseRetention,
  ...run
}: IdIndexOwnerFill & {
  clickhouse: IdIndexFillClient;
  indexes: readonly IdIndexDeclaration[];
}): Promise<IdIndexFillReport> {
  const copied = indexes.filter((each) => each.retention === "copied").map((each) => each.index);
  return fillIdIndexes({
    ...run,
    statements: clickhouse,
    indexes,
    targets: idIndexFillTargets({ privateRoutes: clickhouse.privateRoutes() }),
    beforeMarker: async ({ target }) => {
      if (copied.length === 0) return;
      await raiseRetention({
        ...(target.organizationId === undefined ? {} : { organizationId: target.organizationId }),
        indexes: copied,
      });
    },
  });
}
