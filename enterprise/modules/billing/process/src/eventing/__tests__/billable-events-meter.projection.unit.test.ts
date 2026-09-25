import {
  ClickHouseQueryClient,
  type InsertRequest,
  type QueryDriver,
  type QueryRequest,
  type QueryResult,
} from "@langwatch/clickhouse-client";
import { createTenantId, type Event, type ProjectionStoreContext } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import type { BillableEventRecord } from "../../repositories/billable-events-meter.repository.ts";
import { BillableEventsMeterClickHouseRepository } from "../../repositories/clickhouse/clickhouse.billable-events-meter.repository.ts";
import { PostgresBillingRepositories } from "../../repositories/prisma/prisma.billing.repositories.ts";
import {
  BILLING_TENANT_ORGANIZATION_CACHE_PREFIX,
  BILLING_TENANT_ORGANIZATION_CACHE_TTL_MS,
  RedisBillingTenantOrganizationCacheRepository,
} from "../../repositories/redis/redis.tenant-organization-cache.repository.ts";
import { BillingTenantOrganizationService } from "../../services/tenant-organization.service.ts";
import {
  BILLABLE_EVENTS_METER_PROJECTION_NAME,
  BillableEventsMeterProjection,
} from "../billable-events-meter.projection.ts";

/**
 * App metered event types restated not imported; pins wire values that
 * require migration to change.
 */
const APP_METERED_EVENT_TYPES = [
  "lw.obs.trace.span_received",
  "lw.evaluation.reported",
  "lw.experiment_run.started",
  "lw.experiment_run.evaluator_result",
  "lw.experiment_run.target_result",
  "lw.simulation_run.started",
  "lw.simulation_run.message_snapshot",
];

function billableEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt_1",
    type: "lw.obs.trace.span_received",
    tenantId: "project_alpha",
    createdAt: 1_700_000_000_000,
    ...overrides,
  } as Event;
}

function compose(options: {
  project?: { team: { organizationId: string } } | null;
  redis?: { get: ReturnType<typeof vi.fn>; setex: ReturnType<typeof vi.fn> };
}) {
  const findUnique = vi.fn(async () =>
    options.project === undefined ? { team: { organizationId: "org_1" } } : options.project,
  );
  const redis = options.redis ?? { get: vi.fn(async () => null), setex: vi.fn(async () => "OK") };
  const inserts: InsertRequest[] = [];
  const driver: QueryDriver = {
    async execute<Row>(_: QueryRequest): Promise<QueryResult<Row>> {
      return { rows: [] };
    },
    async insert(request: InsertRequest): Promise<void> {
      inserts.push(request);
    },
    async command(_: QueryRequest): Promise<void> {},
  };

  const organizations = BillingTenantOrganizationService.create({
    organizations: PostgresBillingRepositories.create({
      prisma: { project: { findUnique } } as never,
    }).tenantOrganizations,
    cache: RedisBillingTenantOrganizationCacheRepository.create({ redis: redis as never }),
  });

  const projection = BillableEventsMeterProjection.create({
    organizations,
    meter: BillableEventsMeterClickHouseRepository.create(new ClickHouseQueryClient({ driver })),
  }).build();

  return { projection, findUnique, redis, inserts };
}

const STORE_CONTEXT: ProjectionStoreContext = {
  aggregateId: "billing:evt_1",
  tenantId: createTenantId("project_alpha"),
};

/** `map` is declared nullable by the framework; this meter never returns null. */
function mapped(projection: { map: (event: Event) => unknown }, event: Event): BillableEventRecord {
  return projection.map(event) as BillableEventRecord;
}

describe("BillableEventsMeterProjection", () => {
  describe("given a composed billable-events meter", () => {
    /** @scenario "A billable event is counted against the organization it belongs to" */
    it("writes through the ClickHouse client that organization routes to", async () => {
      const { projection, inserts } = compose({});

      await projection.store.append(mapped(projection, billableEvent()), STORE_CONTEXT);

      expect(inserts).toEqual([expect.objectContaining({ organizationId: "org_1" })]);
    });

    /** @scenario "A billable event is counted against the organization it belongs to" */
    it("stamps the row with the organization and the event's own identity", async () => {
      const { projection, inserts } = compose({});

      await projection.store.append(
        mapped(projection, billableEvent({ idempotencyKey: "project_alpha:eval_9:reported" })),
        STORE_CONTEXT,
      );

      expect(inserts[0]?.rows[0]).toEqual({
        OrganizationId: "org_1",
        TenantId: "project_alpha",
        EventId: "evt_1",
        EventType: "lw.obs.trace.span_received",
        DeduplicationKey: "project_alpha:eval_9:reported",
        EventTimestamp: new Date(1_700_000_000_000),
      });
    });

    /** @scenario "Both graphs attribute a project from one shared keyspace" */
    it("reads and writes attribution under the keyspace the App also reads", async () => {
      const { projection, redis } = compose({});

      await projection.store.append(mapped(projection, billableEvent()), STORE_CONTEXT);

      // The key, lifetime and encoding are spelled out, not read back from
      // their constants: the App writes this exact keyspace via its own
      // `TtlCache<string>(10 * 60 * 1000, "ttlcache:org:resolve:")`, so this
      // assertion checks agreement with a literal in another package.
      expect(redis.get).toHaveBeenCalledWith("ttlcache:org:resolve:project_alpha");
      expect(redis.setex).toHaveBeenCalledWith(
        "ttlcache:org:resolve:project_alpha",
        600,
        '"org_1"',
      );
      expect(BILLING_TENANT_ORGANIZATION_CACHE_PREFIX).toBe("ttlcache:org:resolve:");
      expect(BILLING_TENANT_ORGANIZATION_CACHE_TTL_MS).toBe(600_000);
    });

    /** @scenario "Both graphs attribute a project from one shared keyspace" */
    it("asks the database nothing once the shared cache answers", async () => {
      const redis = {
        get: vi.fn(async () => JSON.stringify("org_cached")),
        setex: vi.fn(async () => "OK"),
      };
      const { projection, findUnique, inserts } = compose({ redis });

      await projection.store.append(mapped(projection, billableEvent()), STORE_CONTEXT);

      expect(findUnique).not.toHaveBeenCalled();
      expect(inserts).toEqual([expect.objectContaining({ organizationId: "org_cached" })]);
    });

    /** @scenario "An orphan project is skipped rather than billed to a neighbour" */
    it("writes no row for a project that belongs to no organization", async () => {
      const { projection, inserts } = compose({ project: null });

      await projection.store.append(mapped(projection, billableEvent()), STORE_CONTEXT);

      expect(inserts).toEqual([]);
    });

    /** @scenario "The meter and its dispatch subscriber keep the names both graphs route" */
    it("declares the projection name and lane the App's twin declares", () => {
      const { projection } = compose({});

      expect(projection.name).toBe(BILLABLE_EVENTS_METER_PROJECTION_NAME);
      expect(BILLABLE_EVENTS_METER_PROJECTION_NAME).toBe("orgBillableEventsMeter");
      expect(projection.options?.groupKeyFn?.(billableEvent())).toBe("billing:evt_1");
    });

    /** @scenario "The meter and its dispatch subscriber keep the names both graphs route" */
    it("subscribes to exactly the billable event types the App's twin subscribes to", () => {
      const { projection } = compose({});

      expect([...projection.eventTypes]).toEqual(APP_METERED_EVENT_TYPES);
    });

    /** @scenario "The meter and its dispatch subscriber keep the names both graphs route" */
    it("falls back to the event id where the producer set no idempotency key", () => {
      const { projection } = compose({});

      expect(mapped(projection, billableEvent()).deduplicationKey).toBe("evt_1");
    });
  });
});
