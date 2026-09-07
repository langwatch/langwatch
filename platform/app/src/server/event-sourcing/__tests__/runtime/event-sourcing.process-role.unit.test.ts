import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProcessRole } from "~/server/app-layer/config";
import { EventSourcing } from "../../eventSourcing";

const captured = vi.hoisted(() => ({
  queues: [] as Array<{ name: string; consumerEnabled?: boolean }>,
}));

vi.mock("../../queues/groupQueue/groupQueue", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../queues/groupQueue/groupQueue")>();

  class CapturingGroupQueueProcessor {
    constructor(
      definition: { name: string },
      _redis: unknown,
      options?: { consumerEnabled?: boolean },
    ) {
      captured.queues.push({
        name: definition.name,
        consumerEnabled: options?.consumerEnabled,
      });
    }

    async waitUntilReady(): Promise<void> {}
    async close(): Promise<void> {}
    async send(): Promise<void> {}
    async sendBatch(): Promise<void> {}
  }

  return { ...actual, GroupQueueProcessor: CapturingGroupQueueProcessor };
});

async function initializeQueueFor(role: ProcessRole): Promise<void> {
  const eventSourcing = new EventSourcing({
    processRole: role,
    redis: {} as never,
  });
  void eventSourcing.globalQueue;
  await eventSourcing.close();
}

describe("EventSourcing process roles", () => {
  afterEach(() => {
    captured.queues.length = 0;
  });

  it("keeps the migration role off the shared queue", async () => {
    await initializeQueueFor("migration");

    expect(captured.queues).toEqual([
      expect.objectContaining({
        name: expect.stringContaining("event-sourcing/migration-jobs"),
        consumerEnabled: true,
      }),
    ]);
    expect(captured.queues[0]?.name).not.toContain("event-sourcing/jobs");
  });

  it("enables the shared queue consumer for the worker role", async () => {
    await initializeQueueFor("worker");

    expect(captured.queues).toEqual([
      expect.objectContaining({
        name: expect.stringContaining("event-sourcing/jobs"),
        consumerEnabled: true,
      }),
    ]);
  });

  it("keeps the shared queue producer-only for the web role", async () => {
    await initializeQueueFor("web");

    expect(captured.queues).toEqual([
      expect.objectContaining({
        name: expect.stringContaining("event-sourcing/jobs"),
        consumerEnabled: false,
      }),
    ]);
  });
});
