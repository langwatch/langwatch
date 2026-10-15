import { EventEmitter } from "node:events";

import { parseProcessConfig } from "@langwatch/config";
import type * as RedisClient from "@langwatch/redis-client";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it, vi } from "vitest";

import { storesOwner } from "../config-owner.ts";
import { openStores } from "../open-stores.ts";
import { PipelineParticipation } from "../pipeline-selection.ts";

const built = vi.hoisted((): { kind: "standalone" | "cluster"; target: unknown }[] => []);

// The connection service is stood in for, so opening the member records the plan and dials nothing.
vi.mock("@langwatch/redis-client", async (original) => {
  const actual = await original<typeof RedisClient>();
  class RecordingConnectionService {
    connectResolved({ config }: { config: RedisClient.RedisConfigResolution }) {
      if (!config.configured) return null;
      built.push(
        config.mode === "cluster"
          ? { kind: "cluster", target: config.endpoints }
          : { kind: "standalone", target: config.url },
      );
      return new EventEmitter();
    }
  }
  return { ...actual, RedisConnectionService: RecordingConnectionService };
});

const storesConfigOf = (environment: Record<string, string>) =>
  parseProcessConfig({
    owners: [storesOwner],
    environment: {
      STORED_OBJECTS_BACKEND: "file",
      LANGWATCH_LOCAL_STORAGE_PATH: "/tmp/langwatch-redis-cluster-test",
      ...environment,
    },
  }).stores;

async function redisOpenedOver(environment: Record<string, string>) {
  built.length = 0;
  const resolver = SecretsResolver.over(SecretsChain.start({ environment }).withEnv());
  const { members } = await openStores({
    name: "redis-cluster-endpoints-test",
    config: storesConfigOf(environment),
    secrets: resolver.scopeTo(storesOwner.name, Object.values(storesOwner.secrets)),
    pipelines: PipelineParticipation.producer(),
    production: false,
  });
  members.read("redis");
  return built;
}

describe("given a deployment that names its Redis by cluster endpoints only", () => {
  /** @scenario "Cluster endpoints open a cluster Redis, as the previous release did" */
  it("opens the redis member as a cluster client over those endpoints", async () => {
    await expect(
      redisOpenedOver({
        REDIS_CLUSTER_ENDPOINTS: "redis1.invalid:7000,redis://redis2.invalid:7001",
      }),
    ).resolves.toEqual([
      {
        kind: "cluster",
        target: [
          { host: "redis1.invalid", port: 7000 },
          { host: "redis2.invalid", port: 7001 },
        ],
      },
    ]);
  });

  it("prefers the endpoints over a leftover REDIS_URL, as the previous release did", async () => {
    const opened = await redisOpenedOver({
      REDIS_URL: "redis://leftover.invalid:6379",
      REDIS_CLUSTER_ENDPOINTS: "redis1.invalid:7000",
    });
    expect(opened.map(({ kind }) => kind)).toEqual(["cluster"]);
  });
});

describe("given a deployment that sets no retention default", () => {
  /** @scenario "An event-log row with no tenant policy keeps the previous release's default" */
  it("stamps 49 days, the previous release's platform default", () => {
    expect(storesConfigOf({}).defaultRetentionDays).toBe(49);
    expect(storesConfigOf({ DEFAULT_RETENTION_DAYS: "" }).defaultRetentionDays).toBe(49);
  });
});
