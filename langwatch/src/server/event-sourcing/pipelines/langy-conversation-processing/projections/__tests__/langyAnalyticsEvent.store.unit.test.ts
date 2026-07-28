import { describe, expect, it, vi } from "vitest";

import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { LangyAnalyticsEventRepository } from "~/server/app-layer/langy/repositories/langy-analytics-event.repository";

import type { LangyAnalyticsEventProjectionRecord } from "../langyAnalyticsEvent.mapProjection";
import { LangyAnalyticsEventAppendStore } from "../langyAnalyticsEvent.store";

const record: LangyAnalyticsEventProjectionRecord = {
  eventId: "event_1",
  eventType: "lw.langy_conversation.conversation_started",
  eventVersion: "2026-07-12",
  aggregateId: "conversation_1",
  turnId: null,
  userId: "user_1",
  role: null,
  toolName: null,
  outcome: null,
  model: null,
  durationMs: null,
  occurredAtMs: 1_000,
  acceptedAtMs: 1_100,
};

function makeRepository(): LangyAnalyticsEventRepository {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    insertBatch: vi.fn().mockResolvedValue(undefined),
  };
}

describe("LangyAnalyticsEventAppendStore", () => {
  it("injects the tenant and resolved trace retention into a single append", async () => {
    const repository = makeRepository();
    const store = new LangyAnalyticsEventAppendStore(repository);

    await store.append(record, {
      tenantId: createTenantId("project_1"),
      aggregateId: "conversation_1",
      retentionPolicy: {
        traces: 45,
        scenarios: 30,
        experiments: 60,
      },
    });

    expect(repository.insert).toHaveBeenCalledWith(
      { tenantId: "project_1", ...record },
      45,
    );
  });

  it("uses one tenant-scoped batch insert during replay", async () => {
    const repository = makeRepository();
    const store = new LangyAnalyticsEventAppendStore(repository);
    const second = { ...record, eventId: "event_2", aggregateId: "conversation_2" };

    await store.bulkAppend([record, second], {
      tenantId: createTenantId("project_1"),
      retentionPolicy: {
        traces: 90,
        scenarios: 30,
        experiments: 60,
      },
    });

    expect(repository.insertBatch).toHaveBeenCalledWith(
      [
        { tenantId: "project_1", ...record },
        { tenantId: "project_1", ...second },
      ],
      90,
    );
  });

  it("does not call the repository for an empty replay batch", async () => {
    const repository = makeRepository();
    const store = new LangyAnalyticsEventAppendStore(repository);

    await store.bulkAppend([], {
      tenantId: createTenantId("project_1"),
    });

    expect(repository.insertBatch).not.toHaveBeenCalled();
  });
});
