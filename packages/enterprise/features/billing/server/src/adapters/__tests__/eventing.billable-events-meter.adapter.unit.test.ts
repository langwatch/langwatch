import { describe, expect, it, vi } from "vitest";
import type { Event, ProjectionStoreContext } from "@langwatch/eventing";
import type { BillableEventRecord } from "../../ports/billable-events-meter.port";
import {
  BILLABLE_EVENTS_METER_PROJECTION_NAME,
  EventingBillableEventsMeterAdapter,
} from "../eventing.billable-events-meter.adapter";
import {
  BILLING_TENANT_ORGANIZATION_CACHE_PREFIX,
  BILLING_TENANT_ORGANIZATION_CACHE_TTL_MS,
  RedisBillingTenantOrganizationCacheAdapter,
} from "../redis.tenant-organization-cache.adapter";
import { ClickHouseBillableEventsMeterAdapter } from "../clickhouse.billable-events-meter.adapter";
import { PostgresBillingTenantOrganizationAdapter } from "../postgres.tenant-organization.adapter";
import { BillingTenantOrganizationService } from "../../services/tenant-organization.service";

/**
 * The event types the App's own twin subscribes to, restated rather than
 * imported.
 *
 * Three of them belong to `@langwatch/experiment-server`, and a feature
 * package may not import another feature's server — so the adapter states them
 * as literals and this list is what pins them. Importing the source of truth
 * here would assert the constants against themselves and pin nothing; these
 * are wire values on events already in the store, so neither side can move
 * without a migration.
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
  insert?: ReturnType<typeof vi.fn>;
  resolveClient?: ReturnType<typeof vi.fn>;
}) {
  const findUnique = vi.fn(async () =>
    options.project === undefined ? { team: { organizationId: "org_1" } } : options.project,
  );
  const redis = options.redis ?? { get: vi.fn(async () => null), setex: vi.fn(async () => "OK") };
  const insert = options.insert ?? vi.fn(async () => undefined);
  const resolveClient = options.resolveClient ?? vi.fn(async () => ({ insert }));

  const organizations = BillingTenantOrganizationService.create({
    organizations: PostgresBillingTenantOrganizationAdapter.create({
      database: { project: { findUnique } } as never,
    }).build().organizations,
    cache: RedisBillingTenantOrganizationCacheAdapter.create({ redis: redis as never }),
  });

  const projection = EventingBillableEventsMeterAdapter.create({
    organizations,
    meter: ClickHouseBillableEventsMeterAdapter.create({
      resolveClient: resolveClient as never,
    }).build(),
  }).build();

  return { projection, findUnique, redis, insert, resolveClient };
}

const STORE_CONTEXT = { tenantId: "project_alpha" } as unknown as ProjectionStoreContext;

/** `map` is declared nullable by the framework; this meter never returns null. */
function mapped(projection: { map: (event: Event) => unknown }, event: Event): BillableEventRecord {
  return projection.map(event) as BillableEventRecord;
}

describe("EventingBillableEventsMeterAdapter", () => {
  describe("given a composed billable-events meter", () => {
    /** @scenario "A billable event is counted against the organization it belongs to" */
    it("writes through the ClickHouse client that organization routes to", async () => {
      const { projection, insert, resolveClient } = compose({});

      await projection.store.append(mapped(projection, billableEvent()), STORE_CONTEXT);

      expect(resolveClient).toHaveBeenCalledWith("org_1");
      expect(insert).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A billable event is counted against the organization it belongs to" */
    it("stamps the row with the organization and the event's own identity", async () => {
      const { projection, insert } = compose({});

      await projection.store.append(
        mapped(projection, billableEvent({ idempotencyKey: "project_alpha:eval_9:reported" })),
        STORE_CONTEXT,
      );

      expect(insert.mock.calls[0]?.[0]?.values?.[0]).toEqual({
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

      // The key, the lifetime and the encoding are spelled out rather than
      // read back from the constants they came from. The App writes this exact
      // keyspace through its own `TtlCache<string>(10 * 60 * 1000,
      // "ttlcache:org:resolve:")`, so what has to hold is agreement with a
      // literal in another package, and an assertion phrased in terms of these
      // constants would follow them wherever they drifted.
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
      const { projection, findUnique, resolveClient } = compose({ redis });

      await projection.store.append(mapped(projection, billableEvent()), STORE_CONTEXT);

      expect(findUnique).not.toHaveBeenCalled();
      expect(resolveClient).toHaveBeenCalledWith("org_cached");
    });

    /** @scenario "An orphan project is skipped rather than billed to a neighbour" */
    it("writes no row for a project that belongs to no organization", async () => {
      const { projection, insert, resolveClient } = compose({ project: null });

      await projection.store.append(mapped(projection, billableEvent()), STORE_CONTEXT);

      expect(resolveClient).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
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
