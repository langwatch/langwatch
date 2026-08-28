import { createEventingRetentionConfiguration } from "@langwatch/eventing/server";
import { OutboundProxyResolverPort } from "@langwatch/aws-client";
import { ResourceScope } from "@langwatch/runtime-composition";
import { describe, expect, it, vi } from "vitest";

const redis = {
  disconnect: vi.fn(() => undefined),
};

vi.mock("@langwatch/redis-client", () => ({
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
}));

import { EventingServerRuntime as RuntimeServer } from "@langwatch/eventing/server";
import { TopicServerInstaller } from "@langwatch/topic-server";
import { TraceProcessingInstallerPort } from "@langwatch/trace-server";
import { TraceTopicAssignmentPort } from "@langwatch/trace-contract";
import { WorkerProductionComposition } from "../src/app/worker-production.composition";
import { resolveWorkerConfig } from "../src/platform/config/worker.config";
import {
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../src/platform/lifecycle/worker-runtime.port";

class NoProxy extends OutboundProxyResolverPort {
  tryResolveForHost(): string | undefined {
    return undefined;
  }
}

class TraceInstaller extends TraceProcessingInstallerPort {
  install() {
    return { traceAssignments: new Assignments() };
  }
}

class Assignments extends TraceTopicAssignmentPort {
  async assignTopic() {}
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
        trace: { installer: new TraceInstaller() },
        topic: {
          database: {} as never,
          redis: null,
          execution: {} as never,
          metrics: {} as never,
        },
      });

      expect(composition.infrastructure?.redis).toBe(redis);
      expect(eventingCreate.mock.calls[0]?.[0].groupQueue).toBe(
        composition.infrastructure?.queueDependencies,
      );
      expect(topicCreate.mock.calls[0]?.[0].redis).toBe(redis);
    } finally {
      eventingCreate.mockRestore();
      topicCreate.mockRestore();
      await resources.close();
      expect(redis.disconnect).toHaveBeenCalledOnce();
      redis.disconnect.mockClear();
    }
  });
});
