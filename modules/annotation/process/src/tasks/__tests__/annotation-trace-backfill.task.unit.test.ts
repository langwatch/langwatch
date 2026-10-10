import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
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
    organizations: createApiFixture<OrganizationApi>({
      listAllIds: async () => ({ ids: ["org-1"], next: null }),
    }),
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

function pagedOver(ids: readonly string[]) {
  const limits: (number | undefined)[] = [];
  const organizations = createApiFixture<OrganizationApi>({
    listAllIds: async ({ after, limit } = {}) => {
      limits.push(limit);
      const rest = ids.filter((id) => after === undefined || id > after);
      const page = rest.slice(0, 2);
      return { ids: page, next: rest.length > 2 ? (page[page.length - 1] ?? null) : null };
    },
  });
  return { organizations, limits };
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

describe("given an install whose organizations arrive in pages", () => {
  describe("when the backfill runs", () => {
    /** @scenario "A fleet scan visits every organization across pages" */
    it("lists the projects of every organization on every page, once each", async () => {
      const { organizations, limits } = pagedOver(["o1", "o2", "o3", "o4", "o5"]);
      const listed: string[] = [];
      const task = AnnotationTraceBackfillTask.create({
        organizations,
        projects: createApiFixture<ProjectApi>({
          listIdsByOrganization: async ({ organizationId }) => {
            listed.push(organizationId);
            return [];
          },
        }),
        annotations: createApiFixture<AnnotationApi>({}),
        traces: createApiFixture<TraceApi>({}),
      });

      await run(task);

      expect(listed).toEqual(["o1", "o2", "o3", "o4", "o5"]);
      expect(limits).toEqual([500, 500, 500]);
    });
  });
});
