/**
 * @vitest-environment node
 * Spec: modules/annotation/specs/annotation-service.feature,
 * modules/organization/specs/organization-id-paging.feature
 */
import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceAnnotationMarker, TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { AnnotationTraceBackfillService } from "../annotation-trace-backfill.service.ts";

const ORGANIZATIONS = ["org_a", "org_b", "org_c"];

/** Three organizations, two a page; each holds one project with one annotated trace. */
function backfillOver() {
  const recorded: string[] = [];
  const saves: unknown[] = [];
  const service = AnnotationTraceBackfillService.create({
    peers: {
      organizations: createApiFixture<OrganizationApi>({
        listAllIds: async ({ after } = {}) => {
          const from = after === undefined ? 0 : ORGANIZATIONS.indexOf(after) + 1;
          const ids = ORGANIZATIONS.slice(from, from + 2);
          return { ids, next: from + 2 < ORGANIZATIONS.length ? (ids.at(-1) ?? null) : null };
        },
      }),
      projects: createApiFixture<ProjectApi>({
        listIdsByOrganization: async ({ organizationId }) => [`${organizationId}_project`],
      }),
      annotations: createApiFixture<AnnotationApi>({
        list: async ({ projectId }) => [
          createApiFixture<Awaited<ReturnType<AnnotationApi["list"]>>[number]>({
            id: `${projectId}_annotation`,
            traceId: `${projectId}_trace`,
          }),
        ],
      }),
      traces: createApiFixture<TraceApi>({
        recordAnnotation: async ({ tenantId }) => void recorded.push(tenantId),
      }),
    },
  });
  const run = ({
    after,
    dryRun = false,
    signal = new AbortController().signal,
  }: { after?: string; dryRun?: boolean; signal?: AbortSignal } = {}) =>
    service.backfill({ after, dryRun, signal, onPage: async (page) => void saves.push(page) });
  return { recorded, saves, run };
}

describe("given the annotation trace step's backfill", () => {
  describe("when it runs over three organizations", () => {
    /** @scenario "The annotation trace step records every organization's annotations a page at a time" */
    it("records each organization's annotations and saves after each page", async () => {
      const { recorded, saves, run } = backfillOver();

      const report = await run();

      expect(recorded).toEqual(["org_a_project", "org_b_project", "org_c_project"]);
      expect(saves).toEqual([{ afterOrganizationId: "org_b" }, { afterOrganizationId: "org_c" }]);
      expect(report).toMatchObject({ afterOrganizationId: "org_c", organizations: 3, traces: 3 });
    });
  });

  describe("when it resumes after a saved page", () => {
    /** @scenario "The annotation trace step resumes after the last page of organizations it saved" */
    it("records only the organizations after the saved one", async () => {
      const { recorded, run } = backfillOver();

      await run({ after: "org_b" });

      expect(recorded).toEqual(["org_c_project"]);
    });
  });

  describe("when it runs as a dry run", () => {
    /** @scenario "A dry run of the annotation trace step records nothing and saves no checkpoint" */
    it("counts the annotations, records none and saves nothing", async () => {
      const { recorded, saves, run } = backfillOver();

      const report = await run({ dryRun: true });

      expect(recorded).toEqual([]);
      expect(saves).toEqual([]);
      expect(report).toMatchObject({ organizations: 3, annotations: 3 });
    });
  });

  describe("when the worker has stopped it", () => {
    /** @scenario "The annotation trace step stops between projects when the worker stops it" */
    it("records nothing and saves no checkpoint", async () => {
      const { recorded, saves, run } = backfillOver();
      const controller = new AbortController();
      controller.abort();

      await run({ signal: controller.signal });

      expect(recorded).toEqual([]);
      expect(saves).toEqual([]);
    });
  });
});

const annotationsByProject: Readonly<Record<string, { id: string; traceId: string }[]>> = {
  "project-a": [
    { id: "a1", traceId: "trace-1" },
    { id: "a2", traceId: "trace-2" },
    { id: "a3", traceId: "trace-1" },
  ],
  "project-b": [{ id: "b1", traceId: "trace-9" }],
};

/** One organization holding two annotated projects; `failingTrace` refuses its record. */
function twoProjects({
  recorded,
  failingTrace,
}: {
  recorded: TraceAnnotationMarker[];
  failingTrace?: string;
}) {
  return AnnotationTraceBackfillService.create({
    peers: {
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
    },
  });
}

const runOnce = (service: AnnotationTraceBackfillService) =>
  service.backfill({
    after: undefined,
    dryRun: false,
    signal: new AbortController().signal,
    onPage: async () => {},
  });

describe("given annotations across two projects", () => {
  describe("when the backfill runs", () => {
    it("records every annotation on its trace, project by project and trace by trace", async () => {
      const recorded: TraceAnnotationMarker[] = [];
      await runOnce(twoProjects({ recorded }));

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
      await runOnce(twoProjects({ recorded, failingTrace: "trace-1" }));

      expect(recorded.map(({ annotationId }) => annotationId)).toEqual(["a2", "b1"]);
    });
  });
});

describe("given an install whose organizations arrive in pages", () => {
  describe("when the backfill runs", () => {
    /** @scenario "A fleet scan visits every organization across pages" */
    it("lists the projects of every organization on every page, once each", async () => {
      const ids = ["o1", "o2", "o3", "o4", "o5"];
      const limits: (number | undefined)[] = [];
      const listed: string[] = [];
      const service = AnnotationTraceBackfillService.create({
        peers: {
          organizations: createApiFixture<OrganizationApi>({
            listAllIds: async ({ after, limit } = {}) => {
              limits.push(limit);
              const rest = ids.filter((id) => after === undefined || id > after);
              const page = rest.slice(0, 2);
              return { ids: page, next: rest.length > 2 ? (page.at(-1) ?? null) : null };
            },
          }),
          projects: createApiFixture<ProjectApi>({
            listIdsByOrganization: async ({ organizationId }) => {
              listed.push(organizationId);
              return [];
            },
          }),
          annotations: createApiFixture<AnnotationApi>({}),
          traces: createApiFixture<TraceApi>({}),
        },
      });

      await runOnce(service);

      expect(listed).toEqual(["o1", "o2", "o3", "o4", "o5"]);
      expect(limits).toEqual([500, 500, 500]);
    });
  });
});
