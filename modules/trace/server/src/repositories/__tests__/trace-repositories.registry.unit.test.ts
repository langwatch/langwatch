/**
 * @vitest-environment node
 *
 * The trace module's own registry, selected the way a memory-only process
 * selects it with `.withPersistence("memory", {})`. A write followed by a
 * read through the SAME instances is what proves the memory tier is not a
 * stub: the module boots without Postgres or ClickHouse behind it.
 */
import { instantiateRepositories } from "@langwatch/runtime-composition";
import { describe, expect, it } from "vitest";

import { traceRepositories } from "../trace-repositories.registry.ts";

function memoryTier() {
  return instantiateRepositories(traceRepositories, { backend: "memory", members: {} });
}

function memorySpan() {
  return {
    id: "span-row-1",
    tenantId: "project-1",
    traceId: "trace-1",
    spanId: "span-1",
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1_700_000_000_000,
    endTimeUnixMs: 1_700_000_000_500,
    durationMs: 500,
    name: "llm call",
    kind: 3,
    resourceAttributes: {},
    spanAttributes: {},
    statusCode: null,
    statusMessage: null,
    instrumentationScope: { name: "langwatch", version: null },
    events: [],
    links: [],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
    retentionDays: 0,
  };
}

describe("given the memory-backed trace repositories", () => {
  describe("when a reviewer correction is written", () => {
    it("reads back the correction it just wrote", async () => {
      const repositories = memoryTier();

      await repositories.editOverlay.upsert({
        projectId: "project-1",
        traceId: "trace-1",
        patch: { input: { value: "corrected" } },
        userId: "user-1",
      });

      await expect(
        repositories.editOverlay.tryFindByProjectAndTrace({
          projectId: "project-1",
          traceId: "trace-1",
        }),
      ).resolves.toMatchObject({ projectId: "project-1", traceId: "trace-1", updatedById: "user-1" });
    });
  });

  describe("when the fold commits a summary", () => {
    it("reads back the summary the projection just committed", async () => {
      const repositories = memoryTier();

      await repositories.summaryProjection.upsert({
        tenantId: "project-1",
        data: { traceId: "trace-1" },
      });

      await expect(
        repositories.summaryProjection.findByTraceId({
          tenantId: "project-1",
          traceId: "trace-1",
        }),
      ).resolves.toMatchObject({ traceId: "trace-1" });
    });
  });

  describe("when a span is written through the span storage row", () => {
    it("reads the trace back through existence and derivation, which share its store", async () => {
      const repositories = memoryTier();

      await repositories.spanStorage.insertSpan(memorySpan());

      await expect(
        repositories.existence.findExistingTraceIds({
          projectId: "project-1",
          traceIds: ["trace-1", "trace-absent"],
        }),
      ).resolves.toEqual(["trace-1"]);
      await expect(
        repositories.derivationSpans.findNormalizedSpansByTraceId({
          tenantId: "project-1",
          traceId: "trace-1",
        }),
      ).resolves.toMatchObject([{ spanId: "span-1", name: "llm call" }]);
    });
  });

  describe("when the postgres tier is selected without its stores", () => {
    it("refuses the selection by naming the members it needs", () => {
      expect(() =>
        instantiateRepositories(traceRepositories, { backend: "live", members: {} }),
      ).toThrow(/clickhouse|prisma/);
    });
  });
});
