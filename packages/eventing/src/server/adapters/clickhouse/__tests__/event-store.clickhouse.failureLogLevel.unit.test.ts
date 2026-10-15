import { createTenantId } from "@langwatch/eventing";
import {
  createEventingRetentionConfiguration,
  EventingClickHouseEventRepository,
  EventingClickHouseEventStore,
  type EventingClickHouseClient,
} from "@langwatch/eventing/server";
import type * as observabilityModule from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { warnSpy, errorSpy } = vi.hoisted(() => ({ warnSpy: vi.fn(), errorSpy: vi.fn() }));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof observabilityModule>();
  return {
    ...actual,
    createLogger: () => ({
      warn: warnSpy,
      error: errorSpy,
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    }),
  };
});

const tenantId = createTenantId("project_abc");

const event = {
  id: "evt_1",
  tenantId,
  aggregateType: "trace" as const,
  aggregateId: "trace_123",
  createdAt: 1_700_000_000_000,
  occurredAt: 1_700_000_000_000,
  type: "lw.obs.trace.span_received" as const,
  version: "2026-01-01",
  data: { foo: "bar" },
};

const storeFailingWith = (failure: Error) => {
  const client: EventingClickHouseClient = {
    query: vi.fn(),
    insert: vi.fn<EventingClickHouseClient["insert"]>().mockRejectedValue(failure),
  };
  const retention = createEventingRetentionConfiguration({ defaultRetentionDays: 49 });
  return EventingClickHouseEventStore.create({
    repository: EventingClickHouseEventRepository.create({
      resolveClient: async () => client,
      retention,
    }),
    retention,
  });
};

describe("EventingClickHouseEventStore.storeEvents failure logging", () => {
  beforeEach(() => {
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  describe("given ClickHouse refuses the insert as too many simultaneous queries", () => {
    /** @scenario "A transient ClickHouse failure storing events is logged at warn" */
    it("logs at warn and still throws the failure", async () => {
      const refused = Object.assign(new Error("Too many simultaneous queries. Maximum: 100."), {
        code: "202",
      });

      const store = storeFailingWith(refused);

      await expect(store.storeEvents([event], { tenantId }, "trace")).rejects.toBe(refused);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ error: refused }),
        "Failed: EventingClickHouseEventStore.storeEvents",
      );
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe("given a failure that is not transient", () => {
    /** @scenario "A transient ClickHouse failure storing events is logged at warn" */
    it("logs at error", async () => {
      const broken = Object.assign(new Error("Code: 60. UNKNOWN_TABLE"), { code: "60" });

      const store = storeFailingWith(broken);

      await expect(store.storeEvents([event], { tenantId }, "trace")).rejects.toBe(broken);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ error: broken }),
        "Failed: EventingClickHouseEventStore.storeEvents",
      );
    });
  });
});
