/**
 * @vitest-environment node
 * Spec: modules/project/specs/project-service.feature
 */
import { ORGANIZATION_ID_PAGE_LIMIT } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { ProjectFactsBackfillService } from "../project-facts-backfill.service.ts";

const ORGANIZATIONS = ["org_a", "org_b", "org_c"];

/** The backfill over an organization twin serving two ids a page; each holds two projects. */
function backfillOver({ withPreview = true }: { withPreview?: boolean } = {}) {
  const asked: unknown[] = [];
  const recorded: string[] = [];
  const previewed: string[] = [];
  const saves: unknown[] = [];
  const service = ProjectFactsBackfillService.create({
    peers: {
      organizations: {
        listAllIds: async (input) => {
          asked.push(input);
          const from = input?.after === undefined ? 0 : ORGANIZATIONS.indexOf(input.after) + 1;
          const ids = ORGANIZATIONS.slice(from, from + 2);
          return { ids, next: from + 2 < ORGANIZATIONS.length ? (ids.at(-1) ?? null) : null };
        },
      },
      record: async ({ organizationId }) => {
        recorded.push(organizationId);
        return 2;
      },
      ...(withPreview
        ? {
            preview: async ({ organizationId }: { organizationId: string }) => {
              previewed.push(organizationId);
              return 2;
            },
          }
        : {}),
    },
  });
  const run = ({ after, dryRun = false }: { after?: string; dryRun?: boolean } = {}) =>
    service.backfill({
      after,
      dryRun,
      signal: new AbortController().signal,
      onPage: async (page) => void saves.push(page),
    });
  return { asked, recorded, previewed, saves, run };
}

describe("given a project fact step's backfill", () => {
  describe("when it runs over three organizations", () => {
    /** @scenario "A project fact step records every organization's projects a page at a time" */
    it("records each organization a page at a time and saves after each page", async () => {
      const { asked, recorded, saves, run } = backfillOver();

      const report = await run();

      expect(asked).toEqual([
        { after: undefined, limit: ORGANIZATION_ID_PAGE_LIMIT },
        { after: "org_b", limit: ORGANIZATION_ID_PAGE_LIMIT },
      ]);
      expect(recorded).toEqual(ORGANIZATIONS);
      expect(saves).toEqual([{ afterOrganizationId: "org_b" }, { afterOrganizationId: "org_c" }]);
      expect(report).toEqual({ afterOrganizationId: "org_c", organizations: 3, projects: 6 });
    });
  });

  describe("when it resumes after a saved page", () => {
    /** @scenario "A project fact step resumes after the last page of organizations it saved" */
    it("records only the organizations after the saved one", async () => {
      const { recorded, run } = backfillOver();

      await run({ after: "org_b" });

      expect(recorded).toEqual(["org_c"]);
    });
  });

  describe("when it runs as a dry run", () => {
    /** @scenario "A dry run of a project fact step records nothing and saves no checkpoint" */
    it("previews each organization, records nothing and saves no checkpoint", async () => {
      const { recorded, previewed, saves, run } = backfillOver();

      const report = await run({ dryRun: true });

      expect(recorded).toEqual([]);
      expect(previewed).toEqual(ORGANIZATIONS);
      expect(saves).toEqual([]);
      expect(report.projects).toBe(6);
    });

    /** @scenario "A dry run of a project fact step records nothing and saves no checkpoint" */
    it("counts no projects when the fact has no preview", async () => {
      const { recorded, saves, run } = backfillOver({ withPreview: false });

      const report = await run({ dryRun: true });

      expect(recorded).toEqual([]);
      expect(saves).toEqual([]);
      expect(report).toEqual({ afterOrganizationId: "org_c", organizations: 3, projects: 0 });
    });
  });

  describe("when the signal aborts before it starts", () => {
    /** @scenario "A project fact step stops between organizations when the worker stops it" */
    it("records nothing and saves no checkpoint", async () => {
      const { recorded, saves } = backfillOver();
      const controller = new AbortController();
      controller.abort();
      const service = ProjectFactsBackfillService.create({
        peers: {
          organizations: { listAllIds: async () => ({ ids: ORGANIZATIONS, next: null }) },
          record: async ({ organizationId }) => {
            recorded.push(organizationId);
            return 1;
          },
        },
      });

      const report = await service.backfill({
        after: undefined,
        dryRun: false,
        signal: controller.signal,
        onPage: async (page) => void saves.push(page),
      });

      expect(recorded).toEqual([]);
      expect(saves).toEqual([]);
      expect(report.afterOrganizationId).toBeNull();
    });
  });
});
