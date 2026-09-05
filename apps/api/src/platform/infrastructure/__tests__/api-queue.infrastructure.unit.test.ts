/**
 * Spec: specs/server/redis-client-ownership.feature — the API composition root
 * owns exactly one Redis connection, hands that one out, and disconnects it on
 * close; a process without Redis holds none at all.
 */
import { ResourceScope } from "@langwatch/runtime-composition";
import { describe, expect, it, vi } from "vitest";
import { ApiQueueAbsenceReportPort, ApiQueueInfrastructure } from "../api-queue.infrastructure";

const { connections } = vi.hoisted(() => ({ connections: [] as FakeConnection[] }));

type FakeConnection = { quit: () => Promise<string>; disconnect: () => void };

vi.mock("@langwatch/redis-client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    RedisConnectionService: class {
      connectResolved({ config }: { config: { configured: boolean } }) {
        if (!config.configured) return undefined;
        const connection = { quit: vi.fn(async () => "OK"), disconnect: vi.fn() };
        connections.push(connection);
        return connection;
      }
    },
    RedisShutdownService: class {
      static create() {
        return new this();
      }
      async shutdown(connection: FakeConnection) {
        await connection.quit();
      }
    },
  };
});

class RecordingAbsence extends ApiQueueAbsenceReportPort {
  readonly reasons: string[] = [];

  absent(reason: "disabled" | "unconfigured"): void {
    this.reasons.push(reason);
  }
}

const configuredRedis = {
  configured: true,
  mode: "standalone",
  url: "redis://127.0.0.1:6379",
} as never;

describe("given an API process configured with Redis", () => {
  describe("when a caller reads the Redis client from the composition", () => {
    /** @scenario The composition root exposes the connection it created */
    it("hands back the same connection the composition root created", () => {
      connections.length = 0;
      const infrastructure = ApiQueueInfrastructure.tryCreate({
        resources: new ResourceScope(),
        redis: configuredRedis,
      });

      expect(connections).toHaveLength(1);
      expect(infrastructure?.redis).toBe(connections[0]);
    });
  });

  describe("when the process closes", () => {
    /** @scenario Closing the application closes the connection */
    it("disconnects the connection it created", async () => {
      connections.length = 0;
      const resources = new ResourceScope();
      ApiQueueInfrastructure.tryCreate({ resources, redis: configuredRedis });

      await resources.close();

      expect(connections[0]!.quit).toHaveBeenCalled();
    });
  });
});

describe("given an API process configured without Redis", () => {
  describe("when a caller reads the Redis client from the composition", () => {
    /** @scenario An application without Redis exposes no client */
    it("composes no queue and therefore no connection, and says why", () => {
      connections.length = 0;
      const report = new RecordingAbsence();

      const infrastructure = ApiQueueInfrastructure.tryCreate({
        resources: new ResourceScope(),
        redis: { configured: false, reason: "unconfigured" } as never,
        report,
      });

      expect(infrastructure).toBeUndefined();
      expect(connections).toHaveLength(0);
      expect(report.reasons).toEqual(["unconfigured"]);
    });
  });
});
