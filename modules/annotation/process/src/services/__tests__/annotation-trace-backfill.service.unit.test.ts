/**
 * @vitest-environment node
 * Spec: modules/annotation/specs/annotation-service.feature
 */
import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
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
