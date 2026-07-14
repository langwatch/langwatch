/**
 * Unit tests for cancellation channel (Redis pub/sub).
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */
import { describe, expect, it, vi } from "vitest";
import {
  publishCancellation,
  subscribeToCancellations,
  CANCELLATION_CHANNEL,
} from "../cancellation-channel";
import type {
  CancellationPublisher,
  CancellationSubscriber,
  CancellationMessage,
} from "../cancellation-channel";

function createMockPublisher(): CancellationPublisher {
  return {
    publish: vi.fn().mockResolvedValue(1),
  };
}

function createMockSubscriber(): CancellationSubscriber {
  return {
    subscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  };
}

describe("publishCancellation", () => {
  it("publishes the message to the cancel channel", async () => {
    const publisher = createMockPublisher();
    const message: CancellationMessage = {
      projectId: "proj1",
      scenarioRunId: "run1",
      batchRunId: "batch1",
    };

    await publishCancellation({ publisher, message });

    expect(publisher.publish).toHaveBeenCalledWith(
      CANCELLATION_CHANNEL,
      JSON.stringify(message),
    );
  });
});

describe("subscribeToCancellations", () => {
  it("subscribes to the cancel channel", async () => {
    const subscriber = createMockSubscriber();
    const onCancel = vi.fn();

    await subscribeToCancellations({ subscriber, onCancel });

    expect(subscriber.subscribe).toHaveBeenCalledWith(CANCELLATION_CHANNEL);
  });

  it("invokes onCancel when a valid message arrives", async () => {
    const subscriber = createMockSubscriber();
    const onCancel = vi.fn();

    await subscribeToCancellations({ subscriber, onCancel });

    const onCall = (subscriber.on as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(onCall[0]).toBe("message");
    const handler = onCall[1] as (channel: string, raw: string) => void;

    const msg: CancellationMessage = {
      projectId: "proj1",
      scenarioRunId: "run1",
      batchRunId: "batch1",
    };
    handler(CANCELLATION_CHANNEL, JSON.stringify(msg));

    expect(onCancel).toHaveBeenCalledWith(msg);
  });

  it("ignores messages from other channels", async () => {
    const subscriber = createMockSubscriber();
    const onCancel = vi.fn();

    await subscribeToCancellations({ subscriber, onCancel });

    const handler = (subscriber.on as ReturnType<typeof vi.fn>).mock.calls[0]![1] as (channel: string, raw: string) => void;
    handler("other:channel", JSON.stringify({ scenarioRunId: "run1" }));

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("ignores malformed messages", async () => {
    const subscriber = createMockSubscriber();
    const onCancel = vi.fn();

    await subscribeToCancellations({ subscriber, onCancel });

    const handler = (subscriber.on as ReturnType<typeof vi.fn>).mock.calls[0]![1] as (channel: string, raw: string) => void;
    handler(CANCELLATION_CHANNEL, "not-json");

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("returns a cleanup function that quits the subscriber", async () => {
    const subscriber = createMockSubscriber();
    const onCancel = vi.fn();

    const unsubscribe = await subscribeToCancellations({ subscriber, onCancel });
    await unsubscribe();

    expect(subscriber.quit).toHaveBeenCalled();
  });
});
