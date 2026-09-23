import { createTenantId, type RetentionPolicyResolver } from "@langwatch/eventing";
import {
  createEventingRetentionConfiguration,
  EventingClickHouseEventRepository,
  EventingClickHouseEventStore,
  type EventingClickHouseClient,
} from "@langwatch/eventing/server";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

/**
 * Stands in for whatever default the composing process injects. A literal on
 * purpose: the platform constant would make both sides of the assertion the
 * same value, unable to distinguish "the INJECTED default" from a shared one.
 */
const INJECTED_DEFAULT_RETENTION_DAYS = 49;

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

  let mockClient: EventingClickHouseClient;
  let insertSpy: Mock<EventingClickHouseClient["insert"]>;

  beforeEach(() => {
    insertSpy = vi.fn<EventingClickHouseClient["insert"]>().mockResolvedValue(undefined);
    mockClient = {
      query: vi.fn(),
      insert: insertSpy,
    };
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
      const retention = createEventingRetentionConfiguration({
        defaultRetentionDays: INJECTED_DEFAULT_RETENTION_DAYS,
      });
      const store = EventingClickHouseEventStore.create({
        repository: EventingClickHouseEventRepository.create({
          resolveClient: async () => mockClient,
          retention,
        }),
        retention,
        retentionPolicyResolver: resolver,
      });

      await store.storeEvents(
        [makeEvent(), { ...makeEvent(), id: "evt_2" }],
        { tenantId },
        aggregateType,
      );

      expect(resolver.resolve).toHaveBeenCalledWith(String(tenantId));
      expect(insertSpy).toHaveBeenCalledTimes(1);
      const insertCall = insertSpy.mock.calls[0]![0]!;
      expect(insertCall.table).toBe("event_log");
      const values = insertCall.values as { _retention_days: number }[];
      expect(values).toHaveLength(2);
      expect(values[0]!._retention_days).toBe(30);
      expect(values[1]!._retention_days).toBe(30);
    });
  });

  describe("when no resolver is wired (e.g. tests)", () => {
    it("falls back to the platform default", async () => {
      const retention = createEventingRetentionConfiguration({
        defaultRetentionDays: INJECTED_DEFAULT_RETENTION_DAYS,
      });
      const store = EventingClickHouseEventStore.create({
        repository: EventingClickHouseEventRepository.create({
          resolveClient: async () => mockClient,
          retention,
        }),
        retention,
      });

      await store.storeEvents([makeEvent()], { tenantId }, aggregateType);

      const values = insertSpy.mock.calls[0]![0]!.values as {
        _retention_days: number;
      }[];
      expect(values[0]!._retention_days).toBe(INJECTED_DEFAULT_RETENTION_DAYS);
    });
  });

  /**
   * event_log does not share one category with the rest of a trace pipeline's
   * tables: a row's own aggregate/event type decides it. The classifier is
   * injected as a plain function; these cases stand in for the real one.
   */
  describe("when an event-log retention classifier is wired", () => {
    it("stamps a row the classifier calls indefinite with _retention_days = 0, ignoring policy", async () => {
      const resolver: RetentionPolicyResolver = {
        resolve: vi.fn().mockResolvedValue({ traces: 30, scenarios: null, experiments: null }),
      };
      const retention = createEventingRetentionConfiguration({
        defaultRetentionDays: INJECTED_DEFAULT_RETENTION_DAYS,
      });
      const store = EventingClickHouseEventStore.create({
        repository: EventingClickHouseEventRepository.create({
          resolveClient: async () => mockClient,
          retention,
        }),
        retention,
        retentionPolicyResolver: resolver,
        classifyEventLogRetention: () => "indefinite",
      });

      await store.storeEvents([makeEvent()], { tenantId }, aggregateType);

      const values = insertSpy.mock.calls[0]![0]!.values as { _retention_days: number }[];
      expect(values[0]!._retention_days).toBe(0);
    });

    it("resolves the policy under the key the classifier returns", async () => {
      const resolver: RetentionPolicyResolver = {
        resolve: vi.fn().mockResolvedValue({ traces: 30, scenarios: 63, experiments: 91 }),
      };
      const retention = createEventingRetentionConfiguration({
        defaultRetentionDays: INJECTED_DEFAULT_RETENTION_DAYS,
      });
      const store = EventingClickHouseEventStore.create({
        repository: EventingClickHouseEventRepository.create({
          resolveClient: async () => mockClient,
          retention,
        }),
        retention,
        retentionPolicyResolver: resolver,
        classifyEventLogRetention: () => "scenarios",
      });

      await store.storeEvents([makeEvent()], { tenantId }, aggregateType);

      const values = insertSpy.mock.calls[0]![0]!.values as { _retention_days: number }[];
      expect(values[0]!._retention_days).toBe(63);
    });

    it("falls back to traces when omitted, unchanged from before the classifier existed", async () => {
      const resolver: RetentionPolicyResolver = {
        resolve: vi.fn().mockResolvedValue({ traces: 30, scenarios: 63, experiments: 91 }),
      };
      const retention = createEventingRetentionConfiguration({
        defaultRetentionDays: INJECTED_DEFAULT_RETENTION_DAYS,
      });
      const store = EventingClickHouseEventStore.create({
        repository: EventingClickHouseEventRepository.create({
          resolveClient: async () => mockClient,
          retention,
        }),
        retention,
        retentionPolicyResolver: resolver,
      });

      await store.storeEvents([makeEvent()], { tenantId }, aggregateType);

      const values = insertSpy.mock.calls[0]![0]!.values as { _retention_days: number }[];
      expect(values[0]!._retention_days).toBe(30);
    });
  });

  describe("when the tenant has no policy configured", () => {
    it("falls back to the platform default", async () => {
      const resolver: RetentionPolicyResolver = {
        resolve: vi.fn().mockResolvedValue(null),
      };
      const retention = createEventingRetentionConfiguration({
        defaultRetentionDays: INJECTED_DEFAULT_RETENTION_DAYS,
      });
      const store = EventingClickHouseEventStore.create({
        repository: EventingClickHouseEventRepository.create({
          resolveClient: async () => mockClient,
          retention,
        }),
        retention,
        retentionPolicyResolver: resolver,
      });

      await store.storeEvents([makeEvent()], { tenantId }, aggregateType);

      const values = insertSpy.mock.calls[0]![0]!.values as {
        _retention_days: number;
      }[];
      expect(values[0]!._retention_days).toBe(INJECTED_DEFAULT_RETENTION_DAYS);
    });
  });
});
