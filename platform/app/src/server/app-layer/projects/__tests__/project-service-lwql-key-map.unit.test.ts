import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "~/generated/prisma/client";
import type { LwqlKeyMapRepository } from "~/server/analytics/lwql/lwqlKeyMap.repository";
import { captureException } from "~/utils/posthogErrorCapture";
import { ProjectService } from "../project.service";
import { NullProjectRepository } from "../repositories/project.repository";

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

describe("ProjectService key-map sync", () => {
  beforeEach(() => {
    vi.stubEnv("LWQL_CLICKHOUSE_PASSWORD", "lwql-unit-test");
    vi.stubEnv("LWQL_CLICKHOUSE_URL", "");
    vi.stubEnv("LWQL_DATABASE", "");
    vi.stubEnv("CLICKHOUSE_URL", "http://default:pw@localhost:8123/langwatch");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(captureException).mockReset();
  });

  describe("given the key-map write fails", () => {
    describe("when a project is created", () => {
      /** @scenario "A key-map write failure does not block project creation" */
      it("still returns the created project and reports the failure", async () => {
        const repo = new NullProjectRepository();
        vi.spyOn(repo, "findActiveTeamInOrganization").mockResolvedValue({
          id: "team_1",
          isPersonal: false,
        });
        vi.spyOn(repo, "findBySlugInTeam").mockResolvedValue(null);
        vi.spyOn(repo, "create").mockImplementation(
          async (data) =>
            ({ ...data, lwqlKey: "lwql-key-1" }) as unknown as Project,
        );
        const keyMap: LwqlKeyMapRepository = {
          insertRow: vi.fn().mockRejectedValue(new Error("ClickHouse down")),
        };

        const project = await new ProjectService(repo, keyMap).create({
          organizationId: "org_1",
          teamId: "team_1",
          name: "Checkout bot",
          language: "other",
          framework: "other",
        });

        expect(project.name).toBe("Checkout bot");
        expect(keyMap.insertRow).toHaveBeenCalledTimes(1);
        expect(captureException).toHaveBeenCalledTimes(1);
      });
    });
  });
});
