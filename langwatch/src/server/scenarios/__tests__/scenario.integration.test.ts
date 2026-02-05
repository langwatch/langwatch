/**
 * @vitest-environment node
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { ScenarioService } from "../scenario.service";

describe("ScenarioService", () => {
  const projectId = "test-project-id";
  const otherProjectId = "other-project-id";
  const service = ScenarioService.create(prisma);

  beforeAll(async () => {
    await getTestUser();

    // Create other project for isolation test
    const existingProject = await prisma.project.findUnique({
      where: { id: otherProjectId },
    });
    if (!existingProject) {
      // Get organization first, then team
      const organization = await prisma.organization.findUnique({
        where: { slug: "test-organization" },
      });
      if (organization) {
        const team = await prisma.team.findFirst({
          where: { slug: "test-team", organizationId: organization.id },
        });
        if (team) {
          await prisma.project.create({
            data: {
              id: otherProjectId,
              name: "Other Project",
              slug: "other-project",
              apiKey: "other-api-key",
              teamId: team.id,
              language: "en",
              framework: "test-framework",
            },
          });
        }
      }
    }
  });

  beforeEach(async () => {
    await prisma.scenario.deleteMany({ where: { projectId } });
    await prisma.scenario.deleteMany({ where: { projectId: otherProjectId } });
  });

  it("creates a scenario", async () => {
    const result = await service.create({
      projectId,
      name: "Refund Test",
      situation: "User requests refund",
      criteria: ["Acknowledges issue"],
      labels: ["support"],
    });

    expect(result.id).toMatch(/^scen_/);
    expect(result.name).toBe("Refund Test");
    expect(result.projectId).toBe(projectId);
  });

  it("gets all scenarios for project", async () => {
    await service.create({
      projectId,
      name: "Scenario A",
      situation: "Test",
      criteria: [],
      labels: [],
    });

    const result = await service.getAll({ projectId });

    expect(result.length).toBe(1);
    expect(result[0]?.name).toBe("Scenario A");
  });

  it("gets scenario by id", async () => {
    const created = await service.create({
      projectId,
      name: "Scenario B",
      situation: "Test",
      criteria: [],
      labels: [],
    });

    const result = await service.getById({ id: created.id, projectId });

    expect(result?.id).toBe(created.id);
    expect(result?.name).toBe("Scenario B");
  });

  it("returns null for non-existent scenario", async () => {
    const result = await service.getById({ id: "scen_nonexistent", projectId });

    expect(result).toBeNull();
  });

  it("updates a scenario", async () => {
    const created = await service.create({
      projectId,
      name: "Original",
      situation: "Original situation",
      criteria: [],
      labels: [],
    });

    const result = await service.update(created.id, projectId, {
      name: "Updated",
      situation: "Updated situation",
    });

    expect(result.name).toBe("Updated");
    expect(result.situation).toBe("Updated situation");
  });

  describe("getByIdIncludingArchived()", () => {
    describe("when the scenario has been archived", () => {
      it("returns the scenario with archivedAt set", async () => {
        const created = await service.create({
          projectId,
          name: "Archived Runner",
          situation: "Test archived scenario",
          criteria: [],
          labels: [],
        });

        // Archive the scenario
        await prisma.scenario.update({
          where: { id: created.id },
          data: { archivedAt: new Date() },
        });

        const result = await service.getByIdIncludingArchived({
          id: created.id,
          projectId,
        });

        expect(result).not.toBeNull();
        expect(result?.id).toBe(created.id);
        expect(result?.archivedAt).not.toBeNull();
      });
    });

    describe("when the scenario is not archived", () => {
      it("returns the scenario with archivedAt null", async () => {
        const created = await service.create({
          projectId,
          name: "Active Scenario",
          situation: "Test active scenario",
          criteria: [],
          labels: [],
        });

        const result = await service.getByIdIncludingArchived({
          id: created.id,
          projectId,
        });

        expect(result).not.toBeNull();
        expect(result?.id).toBe(created.id);
        expect(result?.archivedAt).toBeNull();
      });
    });

    describe("when the scenario does not exist", () => {
      it("returns null", async () => {
        const result = await service.getByIdIncludingArchived({
          id: "scen_nonexistent",
          projectId,
        });

        expect(result).toBeNull();
      });
    });
  });

  it("isolates scenarios by project", async () => {
    // Create scenario in main project
    await service.create({
      projectId,
      name: "Scenario A",
      situation: "Test",
      criteria: [],
      labels: [],
    });

    // Create scenario in other project
    await service.create({
      projectId: otherProjectId,
      name: "Scenario B",
      situation: "Test",
      criteria: [],
      labels: [],
    });

    // Query main project - should only see Scenario A
    const mainResult = await service.getAll({ projectId });
    expect(mainResult.length).toBe(1);
    expect(mainResult[0]?.name).toBe("Scenario A");

    // Query other project - should only see Scenario B
    const otherResult = await service.getAll({ projectId: otherProjectId });
    expect(otherResult.length).toBe(1);
    expect(otherResult[0]?.name).toBe("Scenario B");

    // Cleanup
    await prisma.scenario.deleteMany({ where: { projectId: otherProjectId } });
  });
});
