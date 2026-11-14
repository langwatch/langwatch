import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickhouseRead, tenantScope } from "@langwatch/clickhouse-client/builder";
import { Temporal, toDate, toEpochMs } from "@langwatch/time";
/**
 * StoredObjectsRepository — ClickHouse I/O for the stored_objects table.
 */
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { StoredObject } from "../../rules/stored-object-row.rules.ts";
import { storedObjectSchema } from "../../rules/stored-object-row.rules.ts";
import { StoredObjectsRepository } from "../stored-objects.repository.ts";
import { storedObjectsTable as t } from "./clickhouse.stored-objects.table.ts";

const TABLE_NAME = "stored_objects" as const;

/** The legacy index's operations: the built lookup by id, and the import's raw page query. */
type StoredObjectsClickHouseClient = Readonly<{
  read: ClickHouseQueryClient["read"];
  query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
    SKIP_TENANT_CHECK?: true;
    SKIP_COLD_SCAN_CHECK?: true;
  }): Promise<{ json<Result>(): Promise<Result[]> }>;
}>;

/** Resolves the client one project's stored-object rows live on. */
export interface StoredObjectsClickHouse {
  resolveClient(projectId: string): Promise<StoredObjectsClickHouseClient>;
}

/**
 * The routed ClickHouse store, adapted to the driver shape this repository asks
 * for. One tenant per resolution: every statement names its tenant.
 */
export class RoutedStoredObjectsClickHouse implements StoredObjectsClickHouse {
  static create(clickhouse: ClickHouseQueryClient): RoutedStoredObjectsClickHouse {
    return new RoutedStoredObjectsClickHouse(clickhouse);
  }

  private constructor(private readonly clickhouse: ClickHouseQueryClient) {}

  async resolveClient(projectId: string): Promise<StoredObjectsClickHouseClient> {
    const clickhouse = this.clickhouse;
    return {
      read: (request) => clickhouse.read(request),
      async query(input) {
        const result = await clickhouse.query({
          tenantId: projectId,
          sql: input.query,
          params: input.query_params,
          SKIP_TENANT_CHECK: input.SKIP_TENANT_CHECK,
          SKIP_COLD_SCAN_CHECK: input.SKIP_COLD_SCAN_CHECK,
        });
        return { json: async <Result>() => result.rows as Result[] };
      },
    };
  }
}

const tracer = getLangWatchTracer("langwatch.stored-objects.repository");

/**
 * ClickHouse repository for stored_objects rows.
 */
export class ClickHouseStoredObjectsRepository extends StoredObjectsRepository {
  static create(clickhouse: StoredObjectsClickHouse): ClickHouseStoredObjectsRepository {
    return new ClickHouseStoredObjectsRepository(clickhouse);
  }

  /**
   * The routed connection rather than a client, and per call rather than once:
   * a private-route tenant's rows live on its own cluster, so which client
   * answers is a function of the project the read names.
   */
  private constructor(private readonly clickhouse: StoredObjectsClickHouse) {
    super();
  }

  /**
   * Returns the stored_objects row with the given id, or null if not found. An arrow instance
   * property to match the base class's property-typed declaration.
   */
  tryFindById = async ({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<StoredObject | null> => {
    return tracer.withActiveSpan(
      "StoredObjectsRepository.tryFindById",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "clickhouse",
          "db.operation": "SELECT",
          "tenant.id": projectId,
          "stored_object.id": id,
        },
      },
      async (span) => {
        const client = await this.clickhouse.resolveClient(projectId);

        // The newest version of the one id, elected over the project's rows of that id alone.
        const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
          .from(t)
          .latestVersion()
          .select({
            id: t.id,
            project_id: t.project_id,
            purpose: t.purpose,
            owner_kind: t.owner_kind,
            owner_id: t.owner_id,
            media_type: t.media_type,
            size_bytes: t.size_bytes,
            sha256: t.sha256,
            storage_uri: t.storage_uri,
            created_at: t.created_at,
            inserted_at: t.inserted_at,
          })
          .where(({ eq }) => eq(t.id, id))
          .limit(1)
          .build();
        const { rows } = await client.read({ statement, table: TABLE_NAME });

        span.setAttribute("result.found", rows.length > 0);

        if (rows.length === 0) {
          return null;
        }

        const raw = rows[0]!;
        return storedObjectSchema.parse({
          id: raw.id,
          project_id: raw.project_id,
          purpose: raw.purpose,
          owner_kind: raw.owner_kind,
          owner_id: raw.owner_id,
          media_type: raw.media_type,
          size_bytes: Number(raw.size_bytes),
          sha256: raw.sha256,
          storage_uri: raw.storage_uri,
          created_at: clickHouseDate(raw.created_at),
          inserted_at: clickHouseDate(raw.inserted_at),
        });
      },
    );
  };
}

/**
 * ClickHouse hands a DateTime64 back as an ISO string; the row schema declares
 * a `Date` because the client serialises one on the way back in.
 */
function clickHouseDate(value: unknown): Date {
  return toDate(Temporal.Instant.fromEpochMilliseconds(toEpochMs(value as string)));
}
