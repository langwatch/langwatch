import type { AnnotationApi } from "@langwatch/annotation-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { TraceAnnotationMarker, TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { AnnotationTraceBackfillTask } from "../annotation-trace-backfill.task.ts";

const annotationsByProject: Readonly<Record<string, { id: string; traceId: string }[]>> = {
  "project-a": [
    { id: "a1", traceId: "trace-1" },
    { id: "a2", traceId: "trace-2" },
    { id: "a3", traceId: "trace-1" },
  ],
  "project-b": [{ id: "b1", traceId: "trace-9" }],
};

function backfill(recorded: TraceAnnotationMarker[], failingTrace?: string) {
  return AnnotationTraceBackfillTask.create({
    organizations: createApiFixture<OrganizationApi>({ findAllIds: async () => ["org-1"] }),
    projects: createApiFixture<ProjectApi>({
      listIdsByOrganization: async () => ["project-a", "project-b"],
    }),
    annotations: createApiFixture<AnnotationApi>({
      list: async ({ projectId }) =>
        (annotationsByProject[projectId] ?? []).map((annotation) =>
          createApiFixture<Awaited<ReturnType<AnnotationApi["list"]>>[number]>(annotation),
        ),
    }),
    traces: createApiFixture<TraceApi>({
      recordAnnotation: async (marker) => {
        if (marker.traceId === failingTrace) throw new Error("clickhouse unavailable");
        recorded.push(marker);
      },
    }),
  });
}

const run = (task: AnnotationTraceBackfillTask) =>
  task.run({ args: [], signal: new AbortController().signal });

describe("given annotations across two projects", () => {
  describe("when the backfill runs", () => {
    it("records every annotation on its trace, project by project and trace by trace", async () => {
      const recorded: TraceAnnotationMarker[] = [];
      await run(backfill(recorded));

      expect(
        recorded.map(({ tenantId, traceId, annotationId }) => [tenantId, traceId, annotationId]),
      ).toEqual([
        ["project-a", "trace-1", "a1"],
        ["project-a", "trace-1", "a3"],
        ["project-a", "trace-2", "a2"],
        ["project-b", "trace-9", "b1"],
      ]);
    });
  });

  describe("when one trace fails to record", () => {
    it("skips that trace and carries on with the rest", async () => {
      const recorded: TraceAnnotationMarker[] = [];
      await run(backfill(recorded, "trace-1"));

      expect(recorded.map(({ annotationId }) => annotationId)).toEqual(["a2", "b1"]);
    });
  });
});
