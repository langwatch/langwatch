/**
 * @vitest-environment node
 *
 * Integration tests for scenario archiving.
 *
 * Covers the @integration backend scenarios from scenario-deletion.feature:
 * - Archived scenario has archivedAt timestamp set
 * - Archived scenario does not appear in list queries
 * - Archived scenario is still found by ID for internal lookups
 * - Batch archive sets archivedAt on all selected scenarios
 * - Batch archive reports individual failures
 * - Archiving an already-archived scenario is idempotent
 * - Cannot archive a scenario from a different project
 * - Archiving a non-existent scenario returns not found
 * - Archived scenarios do not count against license limits
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { ScenarioService } from "../scenario.service";
import { ScenarioRepository } from "../scenario.repository";
import { LicenseEnforcementRepository } from "../../license-enforcement/license-enforcement.repository";

describe("ScenarioService", () => {
  const projectId = "test-project-id";
  const otherProjectId = "other-project-id";
  const service = ScenarioService.create(prisma);
  const repository = new ScenarioRepository(prisma);

  beforeAll(async () => {
    await getTestUser();

    // Create other project for isolation test
    const existingProject = await prisma.project.findUnique({
      where: { id: otherProjectId },
    });
    if (!existingProject) {
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

  // Helper to create a scenario
  async function createScenario({
    name,
    project = projectId,
  }: {
    name: string;
    project?: string;
  }) {
    return service.create({
      projectId: project,
      name,
      situation: "Test situation",
      criteria: [],
      labels: [],
    });
  }

  // ==========================================================================
  // Soft Archive Backend Behavior
  // ==========================================================================

  describe("archive()", () => {
    describe("when archiving an existing scenario", () => {
      it("sets archivedAt timestamp on the scenario record", async () => {
        const scenario = await createScenario({ name: "To Archive" });

        const result = await service.archive({
          id: scenario.id,
          projectId,
        });

        expect(result.archivedAt).toBeInstanceOf(Date);
        expect(result.id).toBe(scenario.id);
      });

      it("preserves the scenario record in the database", async () => {
        const scenario = await createScenario({ name: "To Archive" });

        await service.archive({ id: scenario.id, projectId });

        // Use findByIdIncludingArchived to verify record still exists
        const found = await repository.findByIdIncludingArchived({
          id: scenario.id,
          projectId,
        });
        expect(found).not.toBeNull();
        expect(found!.archivedAt).toBeInstanceOf(Date);
      });
    });

    describe("when scenario has been archived", () => {
      it("does not appear in list queries", async () => {
        const scenario = await createScenario({ name: "Archived Scenario" });
        await service.archive({ id: scenario.id, projectId });

        const all = await service.getAll({ projectId });

        expect(all.find((s) => s.id === scenario.id)).toBeUndefined();
      });

      it("is still found by findByIdIncludingArchived for internal lookups", async () => {
        const scenario = await createScenario({ name: "Archived Scenario" });
        await service.archive({ id: scenario.id, projectId });

        const found = await repository.findByIdIncludingArchived({
          id: scenario.id,
          projectId,
        });

        expect(found).not.toBeNull();
        expect(found!.archivedAt).toBeInstanceOf(Date);
      });
    });
  });

  // ==========================================================================
  // Batch Archive
  // ==========================================================================

  describe("batchArchive()", () => {
    describe("when archiving multiple valid scenarios", () => {
      it("sets archivedAt on all selected scenarios", async () => {
        const scenarioA = await createScenario({ name: "Scenario A" });
        const scenarioB = await createScenario({ name: "Scenario B" });

        const result = await service.batchArchive({
          ids: [scenarioA.id, scenarioB.id],
          projectId,
        });

        expect(result.archived).toContain(scenarioA.id);
        expect(result.archived).toContain(scenarioB.id);
        expect(result.failed).toHaveLength(0);
      });

      it("removes archived scenarios from list queries", async () => {
        const scenarioA = await createScenario({ name: "Scenario A" });
        const scenarioB = await createScenario({ name: "Scenario B" });
        const scenarioC = await createScenario({ name: "Scenario C" });

        await service.batchArchive({
          ids: [scenarioA.id, scenarioB.id],
          projectId,
        });

        const all = await service.getAll({ projectId });
        expect(all).toHaveLength(1);
        expect(all[0]!.id).toBe(scenarioC.id);
      });
    });

    describe("when some scenario IDs are invalid", () => {
      it("reports individual failures while archiving valid ones", async () => {
        const validScenario = await createScenario({ name: "Valid Scenario" });

        const result = await service.batchArchive({
          ids: [validScenario.id, "nonexistent-id"],
          projectId,
        });

        expect(result.archived).toContain(validScenario.id);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]!.id).toBe("nonexistent-id");
        expect(result.failed[0]!.error).toBe("Not found");
      });
    });
  });

  // ==========================================================================
  // Negative Paths
  // ==========================================================================

  describe("archive() negative paths", () => {
    describe("when archiving an already-archived scenario", () => {
      it("succeeds without error (idempotent)", async () => {
        const scenario = await createScenario({ name: "Already Archived" });
        await service.archive({ id: scenario.id, projectId });

        // Archive again -- should not throw
        const result = await service.archive({ id: scenario.id, projectId });
        expect(result.archivedAt).toBeInstanceOf(Date);
      });
    });

    describe("when archiving a scenario from a different project", () => {
      it("returns not found error", async () => {
        const scenario = await createScenario({
          name: "Foreign Scenario",
          project: otherProjectId,
        });

        // Try to archive from the wrong project
        await expect(
          service.archive({ id: scenario.id, projectId }),
        ).rejects.toThrow("Scenario not found");
      });
    });

    describe("when archiving a non-existent scenario", () => {
      it("returns not found error", async () => {
        await expect(
          service.archive({ id: "nonexistent-id", projectId }),
        ).rejects.toThrow("Scenario not found");
      });
    });
  });

  // ==========================================================================
  // License Limits
  // ==========================================================================

  describe("license limit counting", () => {
    describe("when scenarios are archived", () => {
      it("excludes archived scenarios from license count", async () => {
        const organization = await prisma.organization.findUnique({
          where: { slug: "test-organization" },
        });
        expect(organization).not.toBeNull();

        const licenseRepo = new LicenseEnforcementRepository(prisma);

        // Create 3 active scenarios
        await createScenario({ name: "Active 1" });
        await createScenario({ name: "Active 2" });
        const toArchive = await createScenario({ name: "To Archive" });

        // Archive one
        await service.archive({ id: toArchive.id, projectId });

        // Count should only include active scenarios
        const count = await licenseRepo.getActiveScenarioCount(organization!.id);
        expect(count).toBe(2);
      });
    });
  });
});
