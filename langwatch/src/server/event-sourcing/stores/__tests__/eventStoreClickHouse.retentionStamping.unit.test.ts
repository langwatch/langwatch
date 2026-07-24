import type { ClickHouseClient } from "@clickhouse/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "../../../data-retention/retentionPolicy.schema";
import type { RetentionPolicyResolver } from "../../../data-retention/retentionPolicyResolver";
import { createTenantId } from "../../domain/tenantId";
import { EventStoreClickHouse } from "../eventStoreClickHouse";
import { EventRepositoryClickHouse } from "../repositories/eventRepositoryClickHouse";

/**
 * @scenario Trace pipeline stamps _retention_days from traces category
 * @scenario No retention policy defaults to the platform default
 * @see specs/data-retention/ingestion-stamping.feature
 *
 * event_log is the source of truth for trace-pipeline events. If the retention
 * resolver returns N days for the tenant, every event_log row in the batch
 * must carry _retention_days = N. Without it, derived projections expire while
 * the raw events survive — re-projection then resurrects deleted data.
 */
describe("EventStoreClickHouse retention stamping", () => {
  const tenantId = createTenantId("project_abc");
  const aggregateId = "trace_123";
  const aggregateType = "trace" as const;

  let mockClient: ClickHouseClient;
  let insertSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    insertSpy = vi.fn().mockResolvedValue(undefined);
    mockClient = {
      query: vi.fn(),
      insert: insertSpy,
    } as unknown as ClickHouseClient;
  });

  const makeEvent = () => ({
    id: "evt_1",
    tenantId,
    aggregateType,
    aggregateId,
    createdAt: 1_700_000_000_000,
    occurredAt: 1_700_000_000_000,
    type: "lw.obs.trace.span_received" as const,
    version: "2026-01-01",
    data: { foo: "bar" },
  });

  describe("when retention resolver returns a policy with traces=30", () => {
    it("stamps every event_log record with _retention_days = 30", async () => {
      const resolver: RetentionPolicyResolver = {
        resolve: vi.fn().mockResolvedValue({
          traces: 30,
          scenarios: null,
          experiments: null,
        }),
      };
      const store = new EventStoreClickHouse(
        new EventRepositoryClickHouse(async () => mockClient),
        resolver,
      );

      await store.storeEvents(
        [makeEvent(), { ...makeEvent(), id: "evt_2" }],
        { tenantId },
        aggregateType,
      );

      expect(resolver.resolve).toHaveBeenCalledWith(String(tenantId));
      expect(insertSpy).toHaveBeenCalledTimes(1);
      const insertCall = insertSpy.mock.calls[0]![0]!;
      expect(insertCall.table).toBe("event_log");
      const values = insertCall.values as Array<{ _retention_days: number }>;
      expect(values).toHaveLength(2);
      expect(values[0]!._retention_days).toBe(30);
      expect(values[1]!._retention_days).toBe(30);
    });
  });

  describe("when no resolver is wired (e.g. tests)", () => {
    it("falls back to the platform default", async () => {
      const store = new EventStoreClickHouse(
        new EventRepositoryClickHouse(async () => mockClient),
      );

      await store.storeEvents([makeEvent()], { tenantId }, aggregateType);

      const values = insertSpy.mock.calls[0]![0]!.values as Array<{
        _retention_days: number;
      }>;
      expect(values[0]!._retention_days).toBe(PLATFORM_DEFAULT_RETENTION_DAYS);
    });
  });

  describe("when the tenant has no policy configured", () => {
    it("falls back to the platform default", async () => {
      const resolver: RetentionPolicyResolver = {
        resolve: vi.fn().mockResolvedValue(null),
      };
      const store = new EventStoreClickHouse(
        new EventRepositoryClickHouse(async () => mockClient),
        resolver,
      );

      await store.storeEvents([makeEvent()], { tenantId }, aggregateType);

      const values = insertSpy.mock.calls[0]![0]!.values as Array<{
        _retention_days: number;
      }>;
      expect(values[0]!._retention_days).toBe(PLATFORM_DEFAULT_RETENTION_DAYS);
    });
  });
});
