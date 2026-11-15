import { describe, expect, it } from "vitest";

import type { LangyAnalyticsEventRecord } from "../../langy-analytics-event.repository.ts";
import { LangyMemoryStore } from "../langy-memory.store.ts";
import { LangyAnalyticsEventMemoryRepository } from "../memory.langy-analytics-event.repository.ts";

const record = (tenantId: string, eventId: string): LangyAnalyticsEventRecord => ({
  tenantId,
  eventId,
  eventType: "lw.langy_conversation.conversation_started",
  eventVersion: "2026-07-12",
  aggregateId: "conversation_1",
  turnId: null,
  userId: null,
  role: null,
  toolName: null,
  outcome: null,
  model: null,
  durationMs: null,
  occurredAtMs: 1_000,
  acceptedAtMs: 1_100,
});

describe("given the langy analytics memory repository asked for stored bytes", () => {
  it("grows with each held row and counts no other tenant's", async () => {
    const repository = LangyAnalyticsEventMemoryRepository.create(LangyMemoryStore.create());
    const before = await repository.getStoredBytes({ tenantId: "project_test" });

    await repository.insertBatch([record("project_test", "a"), record("project_test", "b")]);

    expect(before).toBe(0);
    expect(await repository.getStoredBytes({ tenantId: "project_test" })).toBeGreaterThan(0);
    expect(await repository.getStoredBytes({ tenantId: "project_other" })).toBe(0);
  });
});
