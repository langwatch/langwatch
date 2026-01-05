/**
 * @vitest-environment node
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { ScenarioService } from "../scenario.service";

describe("ScenarioService", () => {
  const projectId = "test-project-id";
  const service = ScenarioService.create(prisma);

  beforeAll(async () => {
    await getTestUser();
  });

  beforeEach(async () => {
    await prisma.scenario.deleteMany({ where: { projectId } });
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
});
