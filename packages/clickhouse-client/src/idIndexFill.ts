/**
 * The background fill of an owner's id indexes from rows older than their views (id-index plan
 * §3): per target, table and partition newest first, one `INSERT … SELECT` per (partition,
 * tenant range) batch, a cursor saved after each. Knows nothing of the upgrade system.
 */
import { assertIdentifier, SHARED_CLICKHOUSE_TARGET } from "./idIndexFlags.ts";
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
}>;

/** A ClickHouse server the fill visits: one per URL, flagged for every organisation on it. */
export type IdIndexFillTarget = Readonly<{
  /** `"shared"`, or the first organisation on the URL; never the URL, which may hold a secret. */
  key: string;
  /** Routes the statements; absent for the shared target. */
  organizationId?: string | undefined;
  /** The flag targets this server answers for: `"shared"`, or each organisation on it. */
  flagTargets: readonly string[];
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

/** The last committed batch. A whole-partition batch has no upper tenant bound. */
export type IdIndexFillCursor = {
  target: string;
  table: string;
  partition: string;
  afterTenantId: string;
  throughTenantId: string | null;
  slice: number;
  slices: number;
};

/** The step's report, replaced whole on each save; `done`/`total` count partitions. */
export type IdIndexFillReport = {
  targetsDone: string[];
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
  /** Runs once a target is filled, before its flags: the retention raise. */
  beforeFlag: (input: { target: IdIndexFillTarget }) => Promise<void>;
  /** Sets the owner's flag for one flag target. */
  setFlag: (input: { target: string }) => Promise<void>;
  /** The pause between retries; a timer by default. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
};

export const DEFAULT_ID_INDEX_BATCH_ROWS = 20_000_000;
const MAX_BATCH_RETRIES = 5;
const FIRST_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const MEMORY_LIMIT_EXCEEDED = "241";

const FILL_SETTINGS = {
  optimize_aggregation_in_order: 1,
  max_threads: 4,
  max_execution_time: 600,
  max_bytes_before_external_group_by: 2_000_000_000,
} as const;

/** One batch of one partition: a tenant range, and a hash slice of a tenant above the size. */
type Batch = Pick<IdIndexFillCursor, "afterTenantId" | "throughTenantId" | "slice" | "slices">;

type Partition = { partition: string; rows: number };

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
    .flatMap(([first, ...rest]) =>
      first === undefined
        ? []
        : [{ key: first, organizationId: first, flagTargets: [first, ...rest] }],
    )
    .toSorted((left, right) => left.key.localeCompare(right.key));
  return [{ key: SHARED_CLICKHOUSE_TARGET, flagTargets: [SHARED_CLICKHOUSE_TARGET] }, ...routed];
}

/** Packs a partition's tenants, in order, into ranges of about `batchRows` source rows. */
export function planBatches({
  partition,
  tenants,
  batchRows,
}: {
  partition: Partition;
  tenants: readonly { tenantId: string; rows: number }[] | null;
  batchRows: number;
}): Batch[] {
  if (tenants === null || partition.rows <= batchRows) {
    return [{ afterTenantId: "", throughTenantId: null, slice: 0, slices: 1 }];
  }
  const packer = new TenantPacker(batchRows);
  for (const tenant of tenants) packer.add(tenant);
  return packer.finish();
}

/** Consecutive tenants share a range; a tenant above the size gets hash slices of its own. */
class TenantPacker {
  private readonly batches: Batch[] = [];
  private after = "";
  private pending = 0;
  private last: string | undefined;

  constructor(private readonly batchRows: number) {}

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

/** Whether `batch` was committed at or before `cursor` in the same partition's walk. */
function isCommitted({ batch, cursor }: { batch: Batch; cursor: IdIndexFillCursor }): boolean {
  if (cursor.throughTenantId === null) return true;
  if (batch.throughTenantId === null) return false;
  if (batch.throughTenantId !== cursor.throughTenantId) {
    return batch.throughTenantId < cursor.throughTenantId;
  }
  return batch.slices === cursor.slices && batch.slice <= cursor.slice;
}

/** The `INSERT … SELECT` one batch runs: the index rows of its tenants in one partition. */
export function fillStatement({ index, batch }: { index: IdIndexDeclaration; batch: Batch }): {
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
  const where = ["_partition_id = {partition:String}", "TenantId > {afterTenantId:String}"];
  const params: Record<string, unknown> = { afterTenantId: batch.afterTenantId };
  if (batch.throughTenantId !== null) {
    where.push("TenantId <= {throughTenantId:String}");
    params.throughTenantId = batch.throughTenantId;
  }
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

const timer = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function isMemoryLimit(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (
    String(Reflect.get(error, "code")) === MEMORY_LIMIT_EXCEEDED ||
    messageOf(error).includes("MEMORY_LIMIT_EXCEEDED")
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
  return {
    target,
    table,
    partition,
    afterTenantId,
    throughTenantId,
    slice: numberOf(field("slice")),
    slices: Math.max(1, numberOf(field("slices"))),
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
 * Fills every declared index on every target, then raises its retention and sets its flags.
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
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: FillIdIndexesOptions) {
    this.report = fillReportOf({ resumeFrom: options.checkpoint.resumeFrom });
    this.batchRows = options.batchRows ?? DEFAULT_ID_INDEX_BATCH_ROWS;
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
        await this.options.beforeFlag({ target });
        for (const flagTarget of target.flagTargets)
          await this.options.setFlag({ target: flagTarget });
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

  /** Partitions and rows the fill would read, with nothing written or flagged. */
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
    if (cursor === null)
      this.report.total += listed.reduce((sum, each) => sum + each.partitions.length, 0);
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
      if (!(await this.fillPartition({ target, index, partition, cursor }))) return false;
      this.report.done += 1;
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
    let batchRows = this.batchRows;
    let tenants: { tenantId: string; rows: number }[] | null = null;
    let committed = cursor;
    let failures = 0;
    for (;;) {
      if (partition.rows > batchRows && tenants === null) {
        tenants = await this.tenantsOf({ target, index, partition });
      }
      const next = planBatches({ partition, tenants, batchRows }).find(
        (batch) => committed === null || !isCommitted({ batch, cursor: committed }),
      );
      if (next === undefined) return true;
      if (this.options.signal.aborted) return false;
      const attempt = await this.insertBatch({ target, index, partition, batch: next });
      if (!attempt.ok) {
        failures += 1;
        batchRows = await this.backOff({ error: attempt.error, failures, batchRows });
        continue;
      }
      committed = {
        target: target.key,
        table: index.index,
        partition: partition.partition,
        ...next,
      };
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
  }: {
    target: IdIndexFillTarget;
    index: IdIndexDeclaration;
    partition: Partition;
    batch: Batch;
  }): Promise<{ ok: true } | { ok: false; error: unknown }> {
    const statement = fillStatement({ index, batch });
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

  /** Pauses 1 s doubling to 30 s; a memory-limit error halves the batch first. */
  private async backOff({
    error,
    failures,
    batchRows,
  }: {
    error: unknown;
    failures: number;
    batchRows: number;
  }): Promise<number> {
    this.report.retries += 1;
    if (failures > MAX_BATCH_RETRIES) throw error;
    await this.sleep(Math.min(MAX_BACKOFF_MS, FIRST_BACKOFF_MS * 2 ** (failures - 1)));
    return isMemoryLimit(error) ? Math.max(1, Math.ceil(batchRows / 2)) : batchRows;
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
    }>({
      ...this.route(target),
      sql:
        "SELECT partition_id, sum(rows) AS rows FROM system.parts " +
        "WHERE database = currentDatabase() AND table = {source:String} AND active " +
        "GROUP BY partition_id ORDER BY partition_id DESC",
      params: { source: assertIdentifier({ name: index.source }) },
      table: "system.parts",
      // The part list describes the server, which no tenant owns.
      SKIP_TENANT_CHECK: true,
    });
    return result.rows.map((row) => ({ partition: row.partition_id, rows: Number(row.rows) }));
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
