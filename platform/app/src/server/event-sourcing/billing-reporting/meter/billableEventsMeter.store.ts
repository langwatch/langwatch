import { createLogger } from "@langwatch/observability";
import { type ClickHouseClient, createAppendStore } from "@langwatch/clickhouse";
import type { AppendStore, BatchContext } from "@langwatch/event-sourcing";
import { billableEventsTable } from "./billableEventsTable";
import type { BillableEventMeterRecord } from "./billableEventsMeter.mapProjection";

const logger = createLogger("langwatch:billing-reporting:billable-events-meter");

/**
 * One billable-events row, once the batch's organization and tenant have
 * been attached. Both are batch-level facts (`BatchContext.tenantId`, and the
 * organization resolved from it) rather than per-record ones, so they are
 * merged in once per `writeBatch` call rather than carried on
 * `BillableEventMeterRecord` itself.
 */
interface BillableEventTableRecord extends BillableEventMeterRecord {
  readonly organizationId: string;
  readonly tenantId: string;
}

/**
 * What the store needs from outside. Both are read-only dependencies on
 * services this pipeline does not own:
 *
 * - `resolveOrganizationId` is `~/server/organizations/resolveOrganizationId`
 *   (TTL-cached project -> organization lookup). Not reimplemented here.
 * - `getClickHouseClientForOrganization` resolves the
 *   `@langwatch/clickhouse` client for an organization's ClickHouse target.
 *
 *   KNOWN GAP: there is today no function with this exact signature.
 *   `~/server/clickhouse/clickhouseClient.ts`'s existing
 *   `getClickHouseClientForOrganization` returns a client built directly on
 *   `@clickhouse/client` — the wire-format, retry-policy and codec ADR-104
 *   and `@langwatch/clickhouse`'s `createClickHouseClient` replace — not a
 *   `@langwatch/clickhouse` `ClickHouseClient`. Building the bridge (or
 *   migrating organization-scoped routing onto `@langwatch/clickhouse`'s
 *   `TenantRouter`/`PoolRegistry`, which route by tenant/project id, not by
 *   organization id) is composition-root work outside this pipeline's
 *   directory, and nothing in the tree does it yet. This store depends on the
 *   *target* shape rather than block on that migration.
 */
export interface BillableEventsMeterStoreDeps {
  readonly resolveOrganizationId: (projectId: string) => Promise<string | undefined>;
  readonly getClickHouseClientForOrganization: (
    organizationId: string,
  ) => Promise<ClickHouseClient | null>;
}

/**
 * Builds the `AppendStore` the map projection writes through (ADR-098,
 * ADR-099, ADR-102).
 *
 * The organization is resolved once per batch, not once per record — every
 * record in one `writeBatch` call shares one `BatchContext.tenantId` (ADR-100:
 * "a batch spans many aggregates of one tenant"), so it shares one
 * organization too. This is a genuine improvement over the pre-rewrite store,
 * which resolved (and re-hit its own cache for) the organization on every
 * single insert because its contract was record-at-a-time.
 *
 * An `AppendStore` for a given resolved client is built once and reused
 * (`@langwatch/clickhouse`'s `createAppendStore` needs one fixed `client` at
 * construction; a per-organization resolver hands back a different client per
 * batch), memoised in a `WeakMap` keyed by the client instance so distinct
 * organizations sharing one ClickHouse target still share one inner store.
 */
export function createBillableEventsMeterStore(
  deps: BillableEventsMeterStoreDeps,
): AppendStore<BillableEventMeterRecord> {
  const innerStores = new WeakMap<
    ClickHouseClient,
    AppendStore<BillableEventTableRecord>
  >();

  function innerStoreFor(client: ClickHouseClient): AppendStore<BillableEventTableRecord> {
    const existing = innerStores.get(client);
    if (existing) return existing;
    const built = createAppendStore({
      client,
      table: billableEventsTable,
      toRow: (record: BillableEventTableRecord) => ({
        OrganizationId: record.organizationId,
        TenantId: record.tenantId,
        EventId: record.eventId,
        EventType: record.eventType,
        DeduplicationKey: record.deduplicationKey,
        EventTimestamp: new Date(record.eventTimestamp),
        UpdatedAt: new Date(),
      }),
    });
    innerStores.set(client, built);
    return built;
  }

  return {
    kind: "append",

    async writeBatch(
      records: readonly BillableEventMeterRecord[],
      context: BatchContext,
    ): Promise<void> {
      if (records.length === 0) return;

      const organizationId = await deps.resolveOrganizationId(context.tenantId);
      if (!organizationId) {
        logger.warn(
          { projectId: context.tenantId },
          "orphan project detected, has no organization -- skipping billable event insert",
        );
        return;
      }

      const client = await deps.getClickHouseClientForOrganization(organizationId);
      if (!client) {
        logger.debug("ClickHouse not configured, skipping billable event insert");
        return;
      }

      const rows: BillableEventTableRecord[] = records.map((record) => ({
        ...record,
        organizationId,
        tenantId: context.tenantId,
      }));

      await innerStoreFor(client).writeBatch(rows, context);
    },
  };
}
