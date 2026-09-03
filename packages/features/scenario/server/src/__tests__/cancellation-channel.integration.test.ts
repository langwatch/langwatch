/** @integration */
import { RedisConnectionService, type RedisConnection } from "@langwatch/redis-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RedisCancellationPublisherAdapter,
  RedisCancellationSubscriberAdapter,
  type CancellationMessage,
} from "../index";

let connection: RedisConnection;

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for Scenario cancellation");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function subscriber(messages: CancellationMessage[]) {
  return RedisCancellationSubscriberAdapter.create(connection.duplicate()).subscribe((message) =>
    messages.push(message),
  );
}

describe.skipIf(!process.env.REDIS_URL)("Redis Scenario cancellation", () => {
  beforeAll(() => {
    const connected = new RedisConnectionService().connect({
      url: process.env.REDIS_URL,
      clusterEndpoints: process.env.REDIS_CLUSTER_ENDPOINTS,
      dbIndex: process.env.REDIS_DB_INDEX,
    });
    if (!connected) {
      throw new Error("Scenario cancellation integration tests require Redis");
    }
    connection = connected;
  });

  afterAll(() => {
    connection?.disconnect();
  });

  it("delivers the complete targeted cancellation payload", async () => {
    const received: CancellationMessage[] = [];
    const unsubscribe = await subscriber(received);
    const message = {
      projectId: "project-1",
      scenarioRunId: "run-1",
      batchRunId: "batch-1",
    };

    await RedisCancellationPublisherAdapter.create(connection).publish(message);
    await waitFor(() => received.length === 1);

    expect(received).toEqual([message]);
    await unsubscribe();
  });

  it("broadcasts each run in a batch to every worker subscriber", async () => {
    const first: CancellationMessage[] = [];
    const second: CancellationMessage[] = [];
    const stopFirst = await subscriber(first);
    const stopSecond = await subscriber(second);
    const publisher = RedisCancellationPublisherAdapter.create(connection);

    await publisher.publish({ projectId: "project-1", scenarioRunId: "run-a" });
    await publisher.publish({ projectId: "project-1", scenarioRunId: "run-b" });
    await waitFor(() => first.length === 2 && second.length === 2);

    expect(first.map((message) => message.scenarioRunId)).toEqual(["run-a", "run-b"]);
    expect(second).toEqual(first);
    await Promise.all([stopFirst(), stopSecond()]);
  });

  it("does not replay a cancellation published before subscription", async () => {
    const publisher = RedisCancellationPublisherAdapter.create(connection);
    await publisher.publish({ projectId: "project-1", scenarioRunId: "run-old" });

    const received: CancellationMessage[] = [];
    const unsubscribe = await subscriber(received);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(received).toEqual([]);
    await unsubscribe();
  });
});
