/**
 * @vitest-environment node
 * Replay's engine, introspection's pipelines and the migration pass's private routes as ops'
 * registries build them: live over the process's members, memory over eventing alone.
 * @see modules/ops/specs/ops-store-seams.feature
 */
import { InMemoryProcessStore } from "@langwatch/eventing";
import type { RetentionPolicyResolver } from "@langwatch/eventing";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { ClickHouseClickHouseRoutesRepository } from "../clickhouse/clickhouse.clickhouse-routes.repository.ts";
import { LiveReplayRuntimeRepository } from "../live/live.replay-runtime.repository.ts";
import { MemoryOpsRepositories } from "../memory/memory.ops.repositories.ts";

const retention: RetentionPolicyResolver = {
  resolve: () => Promise.reject(new Error("no replay here resolves a tenant's retention")),
};

describe("given ops' replay runtime repository", () => {
  describe("when the live registry builds a run's engine over the registered pipelines", () => {
    /** @scenario "A replay run's engine is built by ops' registry over the registered pipelines" */
    it("rebuilds the pipelines' projections and closes its own connection", async () => {
      const disconnected: string[] = [];
      const runConnection = redisDouble({ disconnect: () => void disconnected.push("run") });
      const replayRuntimes = LiveReplayRuntimeRepository.create({
        redis: redisDouble({ isCluster: false, duplicate: () => runConnection }),
        clickhouse: clickHouseQueryClientDouble(),
        eventing: { definitions: [] },
      });

      const runtime = replayRuntimes.create({ retention });

      expect(runtime.projections).toEqual([]);
      expect(runtime.mapProjections).toEqual([]);
      await expect(runtime.close()).resolves.toBeUndefined();
      expect(disconnected).toEqual(["run"]);
    });
  });

  describe("when the memory registry is asked for an engine", () => {
    /** @scenario "A memory process refuses a replay run rather than invent an event log" */
    it("refuses the run", () => {
      const repositories = MemoryOpsRepositories.create({
        eventing: { definitions: [] },
        processStore: InMemoryProcessStore.createForTesting(),
      });

      expect(() => repositories.replayRuntimes.create({ retention })).toThrow(/memory process/);
    });
  });
});

describe("given ops' pipeline definitions and ClickHouse routes repositories", () => {
  describe("when the memory registry built them over the eventing member", () => {
    /** @scenario "Introspection and the migration pass's private routes are read from ops' registry" */
    it("lists eventing's own definitions and holds no private route", () => {
      const eventing = { definitions: [] };
      const repositories = MemoryOpsRepositories.create({
        eventing,
        processStore: InMemoryProcessStore.createForTesting(),
      });

      expect(repositories.pipelineDefinitions.findAll()).toBe(eventing.definitions);
      expect(repositories.clickhouseRoutes.findPrivateRoutes().size).toBe(0);
    });
  });

  describe("when the live registry built the routes over the routed member", () => {
    /** @scenario "Introspection and the migration pass's private routes are read from ops' registry" */
    it("answers the member's own routes", () => {
      const routes = new Map([["org_private", "http://private-clickhouse.invalid:8123"]]);
      const clickhouse = clickHouseQueryClientDouble({ privateRoutes: () => routes });

      expect(ClickHouseClickHouseRoutesRepository.create({ clickhouse }).findPrivateRoutes()).toBe(
        routes,
      );
    });
  });
});
