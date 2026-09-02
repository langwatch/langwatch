import { createEventingRetentionConfiguration } from "@langwatch/eventing/server";
import { OutboundProxyResolverPort } from "@langwatch/aws-client";
import { ResourceScope } from "@langwatch/runtime-composition";
import { describe, expect, it, vi } from "vitest";

/**
 * The process Redis connection, reduced to what the composition does with it:
 * hand it to Eventing, Topic and the GitHub token cache, then disconnect it.
 * The three commands are here because the GitHub adapter refuses a connection
 * that cannot answer them rather than caching into a shape it cannot read.
 */
const redis = {
  get: vi.fn(async () => null),
  set: vi.fn(async () => "OK"),
  del: vi.fn(async () => 0),
  disconnect: vi.fn(() => undefined),
};

vi.mock("@langwatch/redis-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/redis-client")>();

  return {
    ...actual,
    RedisConnectionService: class {
      connectResolved() {
        return redis;
      }
    },
    RedisShutdownService: class {
      static create() {
        return new this();
      }

      shutdown(connection: typeof redis) {
        connection.disconnect();
      }
    },
  };
});

import { EventingServerRuntime as RuntimeServer } from "@langwatch/eventing/server";
import { TopicServerInstaller } from "@langwatch/topic-server";
import { WorkerProductionComposition } from "../worker-production.composition";
import { resolveWorkerConfig } from "../../platform/config/worker.config";
import {
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../../platform/lifecycle/worker-runtime.port";
import { createWorkerProcessDatabase } from "./support/worker-database.double";

class NoProxy extends OutboundProxyResolverPort {
  tryResolveForHost(): string | undefined {
    return undefined;
  }
}

class Lifecycle extends WorkerLifecyclePort {
  async close() {}
}

class Transport extends WorkerTransportPort {
  async start() {
    return {
      shutdown: async () => {},
    };
  }
}

function database() {
  return {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    $transaction: async <Result>(callback: (transaction: object) => Promise<Result>) =>
      callback({}),
    processManagerInbox: {},
    processManagerInstance: {},
    processManagerOutbox: {},
    processManagerOutboxAttempt: {},
  };
}

describe("WorkerProductionComposition infrastructure seam", () => {
  it("constructs one foundation and passes its Redis to Eventing and Topic", async () => {
    const eventingCreate = vi.spyOn(RuntimeServer, "create");
    const topicCreate = vi.spyOn(TopicServerInstaller, "create");
    const resources = new ResourceScope();

    try {
      const composition = WorkerProductionComposition.create({
        config: resolveWorkerConfig({ NODE_ENV: "test" }),
        resources,
        infrastructure: {
          redis: {
            configured: true,
            mode: "standalone",
            url: "redis://localhost:6379",
            db: 0,
            tls: undefined,
            warnings: [],
          },
          outboundProxy: new NoProxy(),
        },
        eventing: {
          database: database(),
          resolveClickHouseClient: async () => ({
            insert: async () => undefined,
            query: async () => ({ json: async () => [] }),
          }),
          retention: createEventingRetentionConfiguration({ defaultRetentionDays: 7 }),
        },
        lifecycle: new Lifecycle(),
        transport: new Transport(),
        topic: {
          database: createWorkerProcessDatabase() as never,
          redis: null,
          execution: {} as never,
          metrics: {} as never,
        },
      });
      const infrastructure = composition.infrastructure;
      if (!infrastructure) {
        throw new Error("Expected Worker infrastructure to be composed");
      }
      const infrastructureClose = vi.spyOn(infrastructure, "close");

      expect(composition.infrastructure?.redis).toBe(redis);
      expect(eventingCreate.mock.calls[0]?.[0].groupQueue).toBe(
        composition.infrastructure?.queueDependencies,
      );
      expect(topicCreate.mock.calls[0]?.[0].redis).toBe(redis);
      await resources.close();
      expect(infrastructureClose).toHaveBeenCalledOnce();
      expect(redis.disconnect).toHaveBeenCalledOnce();
    } finally {
      eventingCreate.mockRestore();
      topicCreate.mockRestore();
      await resources.close();
      redis.disconnect.mockClear();
    }
  });
});
