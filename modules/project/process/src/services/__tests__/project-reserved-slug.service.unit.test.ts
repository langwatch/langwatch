/**
 * The `project:reslug-reserved-dashboards` step over the memory twin: a project holding the slug
 * the Dashboards library reserved moves to the slug minting gives it today, once.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */
import { fromDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryProjectDatabase } from "../../repositories/memory/memory.project.database.ts";
import { MemoryProjectRepository } from "../../repositories/memory/memory.project.repository.ts";
import { ProjectReservedSlugService } from "../project-reserved-slug.service.ts";

const ORGANIZATION_ID = "organization_1";
const TEAM_ID = "team_1";

async function seeded(slugs: Readonly<Record<string, string>>) {
  const database = MemoryProjectDatabase.create();
  database.putOrganization({
    id: ORGANIZATION_ID,
    name: ORGANIZATION_ID,
    presenceEnabled: true,
    traceSharingEnabled: true,
    adminUserIds: [],
    onboardingVariant: null,
    createdAt: fromDate(new Date("2023-10-01T00:00:00.000Z")),
  });
  database.putTeam({
    id: TEAM_ID,
    name: TEAM_ID,
    slug: TEAM_ID,
    organizationId: ORGANIZATION_ID,
    createdAt: new Date("2023-10-01T00:00:00.000Z"),
    updatedAt: new Date("2023-10-01T00:00:00.000Z"),
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  });
  const repository = MemoryProjectRepository.create({ memory: database });
  for (const [id, slug] of Object.entries(slugs)) {
    await repository.create({
      id,
      slug,
      teamId: TEAM_ID,
      name: "Dashboards",
      apiKey: `sk-${id}`,
      language: "python",
      framework: "openai",
    });
  }
  const service = ProjectReservedSlugService.create({ projects: repository });
  const run = (dryRun = false) =>
    service.reslugReserved({ dryRun, signal: new AbortController().signal });
  const slugOf = (id: string) => database.findProject(id)?.slug;
  return { run, slugOf };
}

describe("the reserved-slug step", () => {
  describe("given a project that holds the slug dashboards from before the id suffix", () => {
    /** @scenario '"dashboards" is a reserved project slug' */
    it("gives it its name and id token, then finds nothing on a second run", async () => {
      const { run, slugOf } = await seeded({
        project_old_aaa111: "dashboards",
        project_new_bbb222: "dashboards-bbb222",
      });

      const first = await run();
      const second = await run();

      expect(slugOf("project_old_aaa111")).toBe("dashboards-aaa111");
      expect(slugOf("project_new_bbb222")).toBe("dashboards-bbb222");
      expect(first).toEqual({ reslugged: 1, wouldReslug: 0 });
      expect(second).toEqual({ reslugged: 0, wouldReslug: 0 });
    });

    it("takes a further suffix when another project already holds the minted slug", async () => {
      const { run, slugOf } = await seeded({
        project_old_aaa111: "dashboards",
        project_twin_zzz999: "dashboards-aaa111",
      });

      await expect(run()).resolves.toEqual({ reslugged: 1, wouldReslug: 0 });
      expect(slugOf("project_old_aaa111")).toBe("dashboards-aaa111-2");
      expect(slugOf("project_twin_zzz999")).toBe("dashboards-aaa111");
    });

    it("writes nothing on a dry run, and reports what it would move", async () => {
      const { run, slugOf } = await seeded({ project_old_aaa111: "dashboards" });

      await expect(run(true)).resolves.toEqual({ reslugged: 0, wouldReslug: 1 });
      expect(slugOf("project_old_aaa111")).toBe("dashboards");
    });
  });

  describe("given no project holds the slug", () => {
    it("changes nothing", async () => {
      const { run, slugOf } = await seeded({ project_one_ccc333: "checkout-ccc333" });

      await expect(run()).resolves.toEqual({ reslugged: 0, wouldReslug: 0 });
      expect(slugOf("project_one_ccc333")).toBe("checkout-ccc333");
    });
  });
});
