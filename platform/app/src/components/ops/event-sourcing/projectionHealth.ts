import type { PipelineNode } from "~/server/app-layer/ops/types";

export interface ProjectionMeta {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  kind: "fold" | "map" | "state";
}

export interface ProjectionHealthRow extends ProjectionMeta {
  pending: number;
  active: number;
  blocked: number;
  hasLiveNode: boolean;
}

/**
 * Registry × live tree for projections, the same shape as the subscribers
 * join: the registry knows every projection that exists, the tree only knows
 * the ones with live jobs, and absence must not render as health. Projection
 * jobs file under the normalized "fold"/"map"/"state" type nodes.
 */
export function joinProjectionHealth({
  projections,
  pipelineTree,
}: {
  projections: ProjectionMeta[];
  pipelineTree: PipelineNode[];
}): ProjectionHealthRow[] {
  const live = new Map<
    string,
    { pending: number; active: number; blocked: number }
  >();
  for (const pipeline of pipelineTree) {
    for (const typeNode of pipeline.children) {
      if (
        typeNode.name !== "fold" &&
        typeNode.name !== "map" &&
        typeNode.name !== "state"
      )
        continue;
      for (const nameNode of typeNode.children) {
        live.set(`${pipeline.name}/${typeNode.name}/${nameNode.name}`, {
          pending: nameNode.pending,
          active: nameNode.active,
          blocked: nameNode.blocked,
        });
      }
    }
  }

  const rows = projections.map((meta) => {
    const counts = live.get(
      `${meta.pipelineName}/${meta.kind}/${meta.projectionName}`,
    );
    return {
      ...meta,
      pending: counts?.pending ?? 0,
      active: counts?.active ?? 0,
      blocked: counts?.blocked ?? 0,
      hasLiveNode: counts !== undefined,
    };
  });

  return rows.sort(
    (a, b) =>
      b.blocked - a.blocked ||
      b.pending - a.pending ||
      a.projectionName.localeCompare(b.projectionName),
  );
}
