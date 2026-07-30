/**
 * StoredObjectsRepository — ClickHouse I/O for the stored_objects table.
 *
 * All queries scope to project_id first (tenant isolation) per
 * dev/docs/best_practices/clickhouse-queries.md.
 */
import {
  bindIdentifiers,
  type ClickHouseClient,
  ch,
  createRowCodec,
  defineTable,
  replacing,
  type TableRow,
} from "@langwatch/clickhouse";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { StoredObject } from "./stored-object";
import { storedObjectSchema } from "./stored-object";

/**
 * `stored_objects` (migration 00023). `created_at` and `inserted_at` are both
 * stamped from the same `new Date()` at write time in
 * `stored-objects.service.ts` — never from caller input — so `created_at`
 * genuinely carries the `acceptedAt` role (frozen: the row is content-
 * addressed by `(project_id, id)` and never re-written with a different
 * value) and `inserted_at` is the `ReplacingMergeTree` version column.
 */
const table = defineTable({
  name: "stored_objects",
  merge: replacing({ version: "inserted_at" }),
  sortKey: ["project_id", "id"],
  partition: { by: "toYYYYMM(created_at)", column: "created_at" },
  tenant: ["project_id"],
  columns: {
    id: ch.string(),
    project_id: ch.string(),
    purpose: ch.lowCardinality(ch.string()),
    owner_kind: ch.lowCardinality(ch.string()),
    owner_id: ch.string(),
    media_type: ch.string(),
    size_bytes: ch.uint64(),
    sha256: ch.string(),
    storage_uri: ch.string(),
    created_at: ch.acceptedAt(),
    inserted_at: ch.writtenAt(),
  },
});

type Row = TableRow<typeof table.columns>;

const codec = createRowCodec();
const names = bindIdentifiers();

const ID_STORAGE_URI_COLUMNS = {
  id: ch.string(),
  storage_uri: ch.string(),
} as const;
const ID_STORAGE_URI_NAMES = Object.keys(
  ID_STORAGE_URI_COLUMNS,
) as (keyof typeof ID_STORAGE_URI_COLUMNS)[];
const ID_STORAGE_URI_WIRE = ID_STORAGE_URI_NAMES.map(
  (name) => ID_STORAGE_URI_COLUMNS[name],
);
type IdStorageUriRow = { readonly id: string; readonly storage_uri: string };

const SUM_COLUMNS = {
  total_bytes: ch.uint64(),
  object_count: ch.uint64(),
} as const;
const SUM_COLUMN_NAMES = Object.keys(
  SUM_COLUMNS,
) as (keyof typeof SUM_COLUMNS)[];
const SUM_WIRE_COLUMNS = SUM_COLUMN_NAMES.map((name) => SUM_COLUMNS[name]);
type SumRow = { readonly total_bytes: bigint; readonly object_count: bigint };

function toRow(row: StoredObject): Row {
  return {
    id: row.id,
    project_id: row.project_id,
    purpose: row.purpose,
    owner_kind: row.owner_kind,
    owner_id: row.owner_id,
    media_type: row.media_type,
    // `size_bytes` is `UInt64` in the DDL and decodes to `bigint`, but
    // `StoredObject.size_bytes` stays a JS `number` (pre-existing narrowing —
    // see the migration report). A blob past 2^53 bytes loses precision here,
    // same as before this migration.
    size_bytes: BigInt(row.size_bytes),
    sha256: row.sha256,
    storage_uri: row.storage_uri,
    created_at: row.created_at,
    inserted_at: row.inserted_at,
  };
}

function fromRow(row: Row): StoredObject {
  return storedObjectSchema.parse({
    id: row.id,
    project_id: row.project_id,
    purpose: row.purpose,
    owner_kind: row.owner_kind,
    owner_id: row.owner_id,
    media_type: row.media_type,
    size_bytes: Number(row.size_bytes),
    sha256: row.sha256,
    storage_uri: row.storage_uri,
    created_at: row.created_at,
    inserted_at: row.inserted_at,
  });
}

/**
 * ClickHouse repository for stored_objects rows.
 *
 * The client is injected as `resolveClient(tenantId)` from the composition
 * root (ADR-104) rather than resolved per call inside the repository.
 */
export class StoredObjectsRepository {
  constructor(
    private readonly resolveClient: (tenantId: string) => ClickHouseClient,
    // ADR-104: the new client exposes query/insert/stream only, no DDL or
    // mutation execution. deleteByProject/deleteByIds issue
    // `ALTER TABLE ... DELETE`, which has no home there yet, so they keep
    // resolving the legacy client. See the migration report.
    private readonly legacyResolveClient?: ClickHouseClientResolver,
  ) {}

  /** Inserts a single stored_objects row. */
  async insert({
    projectId,
    row,
  }: {
    projectId: string;
    row: StoredObject;
  }): Promise<void> {
    const encodedRows = codec.encodeRows({
      columns: table.wireColumns,
      columnNames: table.columnNames,
      rows: [toRow(row)],
    });
    const client = this.resolveClient(projectId);
    await client.insert({
      tenantId: projectId,
      table: table.name,
      rows: encodedRows,
      columns: table.columnNames,
      target: { kind: "replacing" },
    });
  }

  /**
   * Returns the stored_objects row with the given id, or null if not found.
   *
   * Uses the scalar-subquery single-row dedup pattern recommended by
   * dev/docs/best_practices/clickhouse-queries.md. The table's version
   * column is `inserted_at`.
   */
  async findById({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<StoredObject | null> {
    const client = this.resolveClient(projectId);
    const result = await client.query({
      tenantId: projectId,
      sql: `
        SELECT ${names.list(table.columnNames)}
        FROM ${names.of(table.name)} AS t
        WHERE t.project_id = {projectId:String}
          AND t.id = {id:String}
          AND t.inserted_at = (
            SELECT max(s.inserted_at)
            FROM ${names.of(table.name)} AS s
            WHERE s.project_id = {projectId:String}
              AND s.id = {id:String}
          )
        LIMIT 1
      `,
      params: { ...names.params, projectId, id },
    });

    const [row] = codec.decodeRows<Row>({
      columns: table.wireColumns,
      columnNames: table.columnNames,
      header: result.header,
      rows: result.rows,
    });
    return row ? fromRow(row) : null;
  }

  /**
   * Streams (id, storage_uri) pairs for every live row owned by the project.
   *
   * Used by `deleteOwnedBy` to enumerate the bytes that need to be deleted
   * from the storage backend before the rows themselves are removed. No
   * `created_at` (partition) predicate is possible here — cascade-delete
   * needs every row that has ever existed for this project, including very
   * old objects sitting in cold S3 partitions.
   */
  async findAllByProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<Array<{ id: string; storage_uri: string }>> {
    const client = this.resolveClient(projectId);
    const result = await client.query({
      tenantId: projectId,
      sql: `
        SELECT id, storage_uri
        FROM ${names.of(table.name)} AS t
        WHERE t.project_id = {projectId:String}
          AND (t.project_id, t.id, t.inserted_at) IN (
            SELECT project_id, id, max(inserted_at)
            FROM ${names.of(table.name)}
            WHERE project_id = {projectId:String}
            GROUP BY project_id, id
          )
      `,
      params: { ...names.params, projectId },
    });

    return codec.decodeRows<IdStorageUriRow>({
      columns: ID_STORAGE_URI_WIRE,
      columnNames: ID_STORAGE_URI_NAMES,
      header: result.header,
      rows: result.rows,
    });
  }

  /**
   * Sums `size_bytes` of the live rows owned by a project, optionally scoped
   * to one `purpose`, as the storage-accounting byte ledger. Dedup uses the
   * IN-tuple `(project_id, id, max(inserted_at))` pattern so only the latest
   * version of each content-addressed row is counted.
   */
  async sumSizeBytesByProject({
    projectId,
    purpose,
  }: {
    projectId: string;
    purpose?: string;
  }): Promise<{ totalBytes: number; objectCount: number }> {
    const client = this.resolveClient(projectId);
    const purposePredicate = purpose ? "AND t.purpose = {purpose:String}" : "";
    const innerPurposePredicate = purpose ? "AND purpose = {purpose:String}" : "";

    const result = await client.query({
      tenantId: projectId,
      sql: `
        SELECT
          sum(t.size_bytes) AS total_bytes,
          count()           AS object_count
        FROM ${names.of(table.name)} AS t
        WHERE t.project_id = {projectId:String}
          ${purposePredicate}
          AND (t.project_id, t.id, t.inserted_at) IN (
            SELECT project_id, id, max(inserted_at)
            FROM ${names.of(table.name)}
            WHERE project_id = {projectId:String}
              ${innerPurposePredicate}
            GROUP BY project_id, id
          )
      `,
      params: purpose
        ? { ...names.params, projectId, purpose }
        : { ...names.params, projectId },
    });

    const [row] = codec.decodeRows<SumRow>({
      columns: SUM_WIRE_COLUMNS,
      columnNames: SUM_COLUMN_NAMES,
      header: result.header,
      rows: result.rows,
    });
    return {
      totalBytes: row ? Number(row.total_bytes) : 0,
      objectCount: row ? Number(row.object_count) : 0,
    };
  }

  /**
   * Deletes every stored_objects row for a project via ClickHouse
   * `ALTER TABLE DELETE`. Callers MUST have already deleted the underlying
   * bytes from the storage backend before invoking this method.
   */
  async deleteByProject({ projectId }: { projectId: string }): Promise<void> {
    const client = await this.requireLegacyClient(projectId);
    await client.exec({
      query: `
        ALTER TABLE ${table.name}
        DELETE WHERE project_id = {projectId:String}
      `,
      query_params: { projectId },
      clickhouse_settings: { mutations_sync: "1" },
    });
  }

  /**
   * Deletes a specific subset of stored-objects rows by id within a project.
   * Rows whose byte-delete failed are intentionally left behind as
   * retryable tombstones — see the docstring on `deleteByProject`.
   */
  async deleteByIds({
    projectId,
    ids,
  }: {
    projectId: string;
    ids: string[];
  }): Promise<void> {
    if (ids.length === 0) return;
    const client = await this.requireLegacyClient(projectId);
    await client.exec({
      query: `
        ALTER TABLE ${table.name}
        DELETE WHERE project_id = {projectId:String}
          AND id IN ({ids:Array(String)})
      `,
      query_params: { projectId, ids },
      clickhouse_settings: { mutations_sync: "1" },
    });
  }

  // ADR-104: the new client has no DDL/mutation method (query/insert/stream
  // only), so the two `ALTER TABLE ... DELETE` mutations above stay on the
  // legacy client until one grows there. See the migration report.
  private async requireLegacyClient(projectId: string) {
    if (!this.legacyResolveClient) {
      throw new Error(
        "StoredObjectsRepository delete methods require a legacy client resolver — the new ClickHouse client has no DDL/mutation method (ADR-104)",
      );
    }
    return this.legacyResolveClient(projectId);
  }
}
