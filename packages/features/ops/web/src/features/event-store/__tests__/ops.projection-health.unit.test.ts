import { describe, expect, it } from "vitest";
import type { PipelineNode } from "@langwatch/ops-contract";
import { joinProjectionHealth, type ProjectionMeta } from "../model/projection-health";

const META: ProjectionMeta = {
  projectionName: "traceSummary",
  pipelineName: "traceProcessing",
  aggregateType: "trace",
  kind: "fold",
};

function treeWith(
  typeName: string,
  counts: { pending: number; active: number; blocked: number },
): PipelineNode[] {
  return [
    {
      name: "traceProcessing",
      ...counts,
      children: [
        {
          name: typeName,
          ...counts,
          children: [{ name: "traceSummary", ...counts, children: [] }],
        },
      ],
    },
  ];
}

describe("joinProjectionHealth", () => {
  it("lists a registered projection with no live node as idle zeros", () => {
    const rows = joinProjectionHealth({
      projections: [META],
      pipelineTree: [],
    });
    expect(rows[0]).toMatchObject({
      projectionName: "traceSummary",
      pending: 0,
      blocked: 0,
      hasLiveNode: false,
    });
  });

  it("joins live fold-node counts onto the registry row", () => {
    const rows = joinProjectionHealth({
      projections: [META],
      pipelineTree: treeWith("fold", { pending: 12, active: 1, blocked: 2 }),
    });
    expect(rows[0]).toMatchObject({
      pending: 12,
      active: 1,
      blocked: 2,
      hasLiveNode: true,
    });
  });

  /** @scenario A map projection's live jobs light up its row */
  it("joins live map-node counts onto a map projection's row", () => {
    const rows = joinProjectionHealth({
      projections: [{ ...META, kind: "map" }],
      pipelineTree: treeWith("map", { pending: 4, active: 1, blocked: 0 }),
    });
    expect(rows[0]).toMatchObject({
      pending: 4,
      active: 1,
      hasLiveNode: true,
    });
  });

  /** @scenario A state projection's live backlog joins its registry row */
  it("joins live state-node counts onto a state projection's row", () => {
    const rows = joinProjectionHealth({
      projections: [{ ...META, kind: "state" }],
      pipelineTree: treeWith("state", { pending: 7, active: 0, blocked: 3 }),
    });
    expect(rows[0]).toMatchObject({
      pending: 7,
      blocked: 3,
      hasLiveNode: true,
    });
  });

  it("does not join counts across the fold/map kind boundary", () => {
    const rows = joinProjectionHealth({
      projections: [META],
      pipelineTree: treeWith("map", { pending: 9, active: 0, blocked: 0 }),
    });
    expect(rows[0]?.hasLiveNode).toBe(false);
  });
});
