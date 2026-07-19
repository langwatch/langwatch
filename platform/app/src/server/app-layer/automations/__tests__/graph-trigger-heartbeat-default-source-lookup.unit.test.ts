/**
 * Regression tests for `defaultGraphTriggerHeartbeatDeps().lookupTriggerSource`.
 *
 * The other heartbeat suites inject `lookupTriggerSource` as a stub, so the
 * real Prisma-backed classifier — the one that runs in production — had no
 * coverage. It used to read `graph.series[0].metric` unconditionally while the
 * trigger's `actionParams.seriesName` names the series it actually watches
 * (`"<index>/<key>/<aggregation>"`).
 *
 * On a mixed graph (series 0 trace-backed, series 1 eval-backed) that
 * misclassified an eval alert as trace-source, so the heartbeat probed
 * `trace_analytics` for recency. With traces still flowing but evals silent it
 * concluded the real-time path had the trigger covered and skipped it — the
 * no-data eval alert never fired.
 */

import { describe, expect, it, vi } from "vitest";
import { defaultGraphTriggerHeartbeatDeps } from "../graph-trigger-heartbeat";
import type { TriggerService } from "../trigger.service";

const PROJECT = "proj-1";
const GRAPH = "graph-1";

const TRACE_METRIC = "performance.total_cost";
const EVAL_METRIC = "evaluations.evaluation_score";

/** A graph whose series 0 is trace-backed and series 1 is eval-backed. */
const MIXED_GRAPH = {
  series: [{ metric: TRACE_METRIC }, { metric: EVAL_METRIC }],
};

function makeDeps(graph: unknown) {
  const findFirst = vi.fn().mockResolvedValue(graph === null ? null : { graph });
  const prisma = {
    customGraph: { findFirst },
  } as unknown as Parameters<
    typeof defaultGraphTriggerHeartbeatDeps
  >[0]["prisma"];

  const deps = defaultGraphTriggerHeartbeatDeps({
    triggers: {} as TriggerService,
    prisma,
  });

  return { deps, findFirst };
}

function lookup(graph: unknown, seriesName?: string) {
  const { deps, findFirst } = makeDeps(graph);
  return {
    result: deps.lookupTriggerSource({
      triggerId: "trig-1",
      customGraphId: GRAPH,
      projectId: PROJECT,
      seriesName,
    }),
    findFirst,
  };
}

describe("defaultGraphTriggerHeartbeatDeps lookupTriggerSource", () => {
  describe("given a mixed trace/eval graph", () => {
    it("classifies from the selected series, not series 0", async () => {
      const { result } = lookup(MIXED_GRAPH, `1/${EVAL_METRIC}/avg`);

      await expect(result).resolves.toBe("evaluation");
    });

    it("classifies series 0 as trace when the trigger selects it", async () => {
      const { result } = lookup(MIXED_GRAPH, `0/${TRACE_METRIC}/sum`);

      await expect(result).resolves.toBe("trace");
    });
  });

  describe("given the graph is scoped to the trigger's project", () => {
    it("filters the lookup by projectId", async () => {
      const { result, findFirst } = lookup(MIXED_GRAPH, `1/${EVAL_METRIC}/avg`);
      await result;

      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: GRAPH, projectId: PROJECT },
        }),
      );
    });
  });

  describe("given the selected series index is out of range", () => {
    // Falling back to series[0] here would resurrect the bug for any trigger
    // whose graph lost a series; undefined makes the caller default to "trace".
    it("returns undefined rather than reading another series", async () => {
      const { result } = lookup(MIXED_GRAPH, `7/${EVAL_METRIC}/avg`);

      await expect(result).resolves.toBeUndefined();
    });
  });

  describe("given a malformed seriesName", () => {
    it("returns undefined for a non-numeric index", async () => {
      const { result } = lookup(MIXED_GRAPH, `abc/${EVAL_METRIC}/avg`);

      await expect(result).resolves.toBeUndefined();
    });
  });

  describe("given no seriesName", () => {
    it("falls back to the first series, preserving legacy behaviour", async () => {
      const { result } = lookup(MIXED_GRAPH, undefined);

      await expect(result).resolves.toBe("trace");
    });
  });

  describe("given the source cannot be determined", () => {
    it("returns undefined when the graph is missing", async () => {
      const { result } = lookup(null, `1/${EVAL_METRIC}/avg`);

      await expect(result).resolves.toBeUndefined();
    });

    it("returns undefined when the graph has no series", async () => {
      const { result } = lookup({}, `0/${TRACE_METRIC}/sum`);

      await expect(result).resolves.toBeUndefined();
    });

    it("returns undefined when the selected series has no metric", async () => {
      const { result } = lookup({ series: [{}, {}] }, `1/x/avg`);

      await expect(result).resolves.toBeUndefined();
    });

    it("returns undefined for a metric in neither source", async () => {
      const { result } = lookup(
        { series: [{ metric: "totally.unknown_metric" }] },
        `0/totally.unknown_metric/sum`,
      );

      await expect(result).resolves.toBeUndefined();
    });
  });
});
