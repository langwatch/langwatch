import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import {
  LangyAnalyticsEventSinkPort,
  LangyAnalyticsEventStorageAdapter,
  type LangyAnalyticsEventProjectionRecord,
} from "@langwatch/langy-server";

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

class FakeLangyAnalyticsEventSink extends LangyAnalyticsEventSinkPort {
  readonly insert = vi.fn().mockResolvedValue(undefined);
  readonly insertBatch = vi.fn().mockResolvedValue(undefined);
}

describe("LangyAnalyticsEventAppendStore", () => {
  it("injects the tenant and resolved trace retention into a single append", async () => {
    const sink = new FakeLangyAnalyticsEventSink();
    const store = LangyAnalyticsEventStorageAdapter.create({
      sink,
      defaultRetentionDays: 49,
    });

    await store.append(record, {
      tenantId: createTenantId("project_1"),
      aggregateId: "conversation_1",
      retentionPolicy: {
        traces: 45,
        scenarios: 30,
        experiments: 60,
      },
    });

    expect(sink.insert).toHaveBeenCalledWith({ tenantId: "project_1", ...record }, 45);
  });

  it("uses one tenant-scoped batch insert during replay", async () => {
    const sink = new FakeLangyAnalyticsEventSink();
    const store = LangyAnalyticsEventStorageAdapter.create({
      sink,
      defaultRetentionDays: 49,
    });
    const second = {
      ...record,
      eventId: "event_2",
      aggregateId: "conversation_2",
    };

    await store.bulkAppend([record, second], {
      tenantId: createTenantId("project_1"),
      retentionPolicy: {
        traces: 90,
        scenarios: 30,
        experiments: 60,
      },
    });

    expect(sink.insertBatch).toHaveBeenCalledWith(
      [
        { tenantId: "project_1", ...record },
        { tenantId: "project_1", ...second },
      ],
      90,
    );
  });

  it("does not call the repository for an empty replay batch", async () => {
    const sink = new FakeLangyAnalyticsEventSink();
    const store = LangyAnalyticsEventStorageAdapter.create({
      sink,
      defaultRetentionDays: 49,
    });

    await store.bulkAppend([], {
      tenantId: createTenantId("project_1"),
    });

    expect(sink.insertBatch).not.toHaveBeenCalled();
  });
});
