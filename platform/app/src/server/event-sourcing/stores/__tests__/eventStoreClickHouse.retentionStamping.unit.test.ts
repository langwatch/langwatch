import type { ClickHouseClient } from "@clickhouse/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INDEFINITE_RETENTION_DAYS,
  PLATFORM_DEFAULT_RETENTION_DAYS,
} from "../../../data-retention/retentionPolicy.schema";
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

  const indefiniteEventCases = [
    ["identity", "user_identity", "lw.identity.identifier_attached"],
    ["MFA", "user_identity", "lw.identity.mfa_enrolled"],
    ["SSO", "sso_connection", "lw.identity.connection_registered"],
    ["join request", "join_request", "lw.identity.join_requested"],
    ["SCIM", "scim_sync", "lw.identity.scim_token_issued"],
    ["authorization", "authz_grant", "lw.authz.grant.attached"],
    ["authorization role", "authz_role", "lw.authz.role.defined"],
    ["virtual-key lifecycle", "governance_subject", "lw.governance.vk_lifecycle"],
  ] as const;

  const categoryEventCases = [
    ["simulation run", "simulation_run", "lw.simulation_run.started", 63],
    ["simulation set", "simulation_set", "lw.simulation_set.archived", 63],
    ["suite run", "suite_run", "lw.suite_run.started", 63],
    ["experiment run", "experiment_run", "lw.experiment_run.started", 91],
    ["Langy conversation", "langy_conversation", "lw.langy_conversation.message_recorded", 49],
    ["topic model", "topic_clustering", "lw.obs.topic_clustering.topics_recorded", 49],
    ["gateway spend", "gateway_request", "lw.gateway.spend.confirmed", 49],
    ["pulled usage", "pulled_usage", "lw.obs.pulled_usage.observed", 49],
    ["ingestion pull", "ingestion_pull", "lw.obs.ingestion_pull.run_completed", 49],
    ["automation trigger", "trigger", "lw.automation.trigger.match_recorded", 49],
    [
      "coding agent session",
      "coding_agent_session",
      "lw.obs.coding_agent_session.span_facts_contributed",
      49,
    ],
    ["governance budget crossing", "governance_subject", "lw.governance.budget_crossing", 49],
  ] as const;

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

  describe.each(indefiniteEventCases)(
    "when storing a %s security event",
    (_name, authAggregateType, authEventType) => {
      it("stamps indefinite retention without consulting tenant policy", async () => {
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
        const event = {
          ...makeEvent(),
          aggregateId: "auth_123",
          aggregateType: authAggregateType,
          type: authEventType,
        };

        await store.storeEvents([event], { tenantId }, authAggregateType);

        expect(resolver.resolve).not.toHaveBeenCalled();
        const values = insertSpy.mock.calls[0]![0]!.values as Array<{
          _retention_days: number;
        }>;
        expect(values[0]!._retention_days).toBe(INDEFINITE_RETENTION_DAYS);
      });
    },
  );

  describe.each(categoryEventCases)(
    "when storing a %s event",
    (_name, eventAggregateType, eventType, expectedRetentionDays) => {
      it("stamps retention from the aggregate's category", async () => {
        const resolver: RetentionPolicyResolver = {
          resolve: vi.fn().mockResolvedValue({
            traces: 49,
            scenarios: 63,
            experiments: 91,
          }),
        };
        const store = new EventStoreClickHouse(
          new EventRepositoryClickHouse(async () => mockClient),
          resolver,
        );
        const event = {
          ...makeEvent(),
          aggregateId: "workload_123",
          aggregateType: eventAggregateType,
          type: eventType,
        };

        await store.storeEvents([event], { tenantId }, eventAggregateType);

        const values = insertSpy.mock.calls[0]![0]!.values as Array<{
          _retention_days: number;
        }>;
        expect(values[0]!._retention_days).toBe(expectedRetentionDays);
      });
    },
  );

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
      const store = new EventStoreClickHouse(new EventRepositoryClickHouse(async () => mockClient));

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
