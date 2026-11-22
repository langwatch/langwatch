/**
 * @vitest-environment node
 * A manual replay lists the tenant directory's privately routed tenants beside the log's.
 * @see packages/eventing/src/replay/replayTenantUnion.ts
 */
import type * as Eventing from "@langwatch/eventing";
import type { ReplayEventSource, RetentionPolicyResolver } from "@langwatch/eventing";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it, vi } from "vitest";

const captured: { eventSource?: ReplayEventSource } = {};

vi.mock("@langwatch/eventing", async (importOriginal) => {
  const original = await importOriginal<typeof Eventing>();
  return {
    ...original,
    upcastReplayEventSource: (): ReplayEventSource => ({
      discoverTenants: () => Promise.resolve(["log_tenant"]),
      discoverAffectedAggregates: () => Promise.resolve([]),
      countEventsForAggregates: () => Promise.resolve(0),
      getBoundedCutoffs: () => Promise.resolve({ cutoffs: new Map(), occurredAtBounds: undefined }),
      streamEventsForAggregates: () => Promise.resolve({ eventsApplied: 0 }),
      loadAggregateEvents: () => Promise.resolve([]),
    }),
    ReplayService: class {
      constructor(options: { eventSource: ReplayEventSource }) {
        captured.eventSource = options.eventSource;
      }
    },
  };
});

const { LiveReplayRuntimeRepository } = await import("../live/live.replay-runtime.repository.ts");

const retention: RetentionPolicyResolver = { resolve: () => Promise.reject(new Error("unused")) };

async function* privateTenants() {
  yield "private_tenant";
  yield "log_tenant";
}

const build = (withPrivate: boolean) =>
  LiveReplayRuntimeRepository.create({
    redis: redisDouble({ isCluster: false, duplicate: () => redisDouble({}) }),
    clickhouse: clickHouseQueryClientDouble(),
    eventing: { definitions: [] },
    ...(withPrivate ? { privateTenants } : {}),
  }).create({ retention });

describe("given ops' live replay runtime repository", () => {
  describe("when the tenant directory lists private tenants", () => {
    it("discovers the log's tenants and the private ones once each", async () => {
      build(true);

      const tenants = await captured.eventSource?.discoverTenants?.({ eventTypes: [], sinceMs: 0 });

      expect([...(tenants ?? [])].toSorted()).toEqual(["log_tenant", "private_tenant"]);
    });
  });

  describe("when no listing is given", () => {
    it("discovers the log's tenants alone", async () => {
      build(false);

      const tenants = await captured.eventSource?.discoverTenants?.({ eventTypes: [], sinceMs: 0 });

      expect(tenants).toEqual(["log_tenant"]);
    });
  });
});
