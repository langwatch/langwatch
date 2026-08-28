import { ResourceScope } from "@langwatch/runtime-composition";
import { describe, expect, it, vi } from "vitest";

const redis = {
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

import { EventingServerRuntime } from "@langwatch/eventing/server";
import { TraceProcessingInstallerPort } from "@langwatch/trace-server";
import { TraceTopicAssignmentPort } from "@langwatch/trace-contract";
import { createWorkerDurableComposition } from "../src/app/worker-durable.composition";
import { resolveWorkerConfig } from "../src/platform/config/worker.config";
import {
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../src/platform/lifecycle/worker-runtime.port";
import { WorkerProjectS3SourcePort } from "../src/platform/infrastructure/worker-stored-object-storage.adapter";

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
    return { shutdown: async () => {} };
  }
}

class NoProjectBuckets extends WorkerProjectS3SourcePort {
  async tryGet() {
    return null;
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

function compose(resources: ResourceScope, overrides?: { defaultRetentionDays?: number }) {
  return createWorkerDurableComposition({
    config: resolveWorkerConfig({
      NODE_ENV: "test",
      REDIS_URL: "redis://localhost:6379",
    }),
    resources,
    lifecycle: new Lifecycle(),
    transport: new Transport(),
    persistence: {
      database: database(),
      resolveClickHouseClient: async () => ({
        insert: async () => undefined,
        query: async () => ({ json: async () => [] }),
      }),
      defaultRetentionDays: overrides?.defaultRetentionDays ?? 30,
    },
    storage: { projects: new NoProjectBuckets() },
    trace: { installer: new TraceInstaller() },
    topic: {
      database: {} as never,
      redis: null,
      execution: {} as never,
      metrics: {} as never,
    },
  });
}

describe("createWorkerDurableComposition", () => {
  describe("when the process supplies its persistence and storage ports", () => {
    it("builds one Group Queue foundation and hands it to the durable Eventing graph", async () => {
      const eventingCreate = vi.spyOn(EventingServerRuntime, "create");
      const resources = new ResourceScope();

      try {
        const composition = compose(resources);

        expect(composition.infrastructure?.redis).toBe(redis);
        expect(eventingCreate.mock.calls[0]?.[0].groupQueue).toBe(
          composition.infrastructure?.queueDependencies,
        );
      } finally {
        eventingCreate.mockRestore();
        await resources.close();
        redis.disconnect.mockClear();
      }
    });

    it("keeps the shared-queue consumer disabled", async () => {
      const eventingCreate = vi.spyOn(EventingServerRuntime, "create");
      const resources = new ResourceScope();

      try {
        compose(resources);

        expect(eventingCreate.mock.calls[0]?.[0].consumersEnabled).toBe(false);
      } finally {
        eventingCreate.mockRestore();
        await resources.close();
        redis.disconnect.mockClear();
      }
    });

    it("validates the retention fallback rather than passing it through unchecked", async () => {
      const resources = new ResourceScope();

      try {
        expect(() => compose(resources, { defaultRetentionDays: 0 })).toThrow();
      } finally {
        await resources.close();
        redis.disconnect.mockClear();
      }
    });

    it("releases every client it constructed when the resource scope closes", async () => {
      const resources = new ResourceScope();
      const composition = compose(resources);
      const infrastructure = composition.infrastructure;
      if (!infrastructure) {
        throw new Error("Expected the durable composition to construct infrastructure");
      }
      const infrastructureClose = vi.spyOn(infrastructure, "close");

      try {
        await resources.close();

        expect(infrastructureClose).toHaveBeenCalledOnce();
        expect(redis.disconnect).toHaveBeenCalledOnce();
      } finally {
        infrastructureClose.mockRestore();
        redis.disconnect.mockClear();
      }
    });
  });
});
