/**
 * Unit tests for cancellation channel (Redis pub/sub).
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { CancellationMessage } from "../app/scenario.app.ts";
import {
  CANCELLATION_CHANNEL,
  type CancellationPublisherClient,
  type CancellationSubscriberClient,
  RedisScenarioCancellationRepository,
} from "../repositories/redis/redis.scenario-cancellation.repository.ts";

function createMockPublisher(): CancellationPublisherClient {
  return {
    publish: vi.fn().mockResolvedValue(1),
  };
}

function createMockSubscriber(): CancellationSubscriberClient {
  return {
    subscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  };
}

/** The live repository over one mocked connection, whose duplicate is the subscriber. */
function repositoryOver({
  publisher = createMockPublisher(),
  subscriber = createMockSubscriber(),
}: {
  publisher?: CancellationPublisherClient;
  subscriber?: CancellationSubscriberClient;
}) {
  return RedisScenarioCancellationRepository.create({
    publish: publisher.publish,
    duplicate: () => subscriber,
  });
}

describe("publishCancellation", () => {
  it("publishes the message to the cancel channel", async () => {
    const publisher = createMockPublisher();
    const message: CancellationMessage = {
      projectId: "proj1",
      scenarioRunId: "run1",
      batchRunId: "batch1",
    };

    await repositoryOver({ publisher }).publish(message);

    expect(publisher.publish).toHaveBeenCalledWith(CANCELLATION_CHANNEL, JSON.stringify(message));
  });
});

describe("subscribeToCancellations", () => {
  it("subscribes to the cancel channel", async () => {
    const subscriber = createMockSubscriber();
    const onCancel = vi.fn();

    await repositoryOver({ subscriber }).subscribe(onCancel);

    expect(subscriber.subscribe).toHaveBeenCalledWith(CANCELLATION_CHANNEL);
  });

  it("invokes onCancel when a valid message arrives", async () => {
    const subscriber = createMockSubscriber();
    const onCancel = vi.fn();

    await repositoryOver({ subscriber }).subscribe(onCancel);

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

    await repositoryOver({ subscriber }).subscribe(onCancel);

    const handler = (subscriber.on as ReturnType<typeof vi.fn>).mock.calls[0]![1] as (
      channel: string,
      raw: string,
    ) => void;
    handler("other:channel", JSON.stringify({ scenarioRunId: "run1" }));

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("ignores malformed messages", async () => {
    const subscriber = createMockSubscriber();
    const onCancel = vi.fn();

    await repositoryOver({ subscriber }).subscribe(onCancel);

    const handler = (subscriber.on as ReturnType<typeof vi.fn>).mock.calls[0]![1] as (
      channel: string,
      raw: string,
    ) => void;
    handler(CANCELLATION_CHANNEL, "not-json");

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("returns a cleanup function that quits the subscriber", async () => {
    const subscriber = createMockSubscriber();
    const onCancel = vi.fn();

    const unsubscribe = await repositoryOver({ subscriber }).subscribe(onCancel);
    await unsubscribe();

    expect(subscriber.quit).toHaveBeenCalled();
  });
});
