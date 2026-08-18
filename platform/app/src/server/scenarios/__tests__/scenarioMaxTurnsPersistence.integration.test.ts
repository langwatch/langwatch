/**
 * @vitest-environment node
 *
 * Real-Postgres integration coverage for persisting the per-scenario turn
 * cap on a Scenario.
 *
 * Requires: PostgreSQL (Prisma). Runs unconditionally — every harness
 * provides Postgres.
 *
 * @see specs/scenarios/scenario-max-turns.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { prisma } from "../../db";
import { ScenarioService } from "../scenario.service";

describe("Scenario turn cap persistence (real DB)", () => {
  const ns = `max-turns-${nanoid(8)}`;
  let projectId: string;
  let teamId: string;
  let organizationId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: `Turns Org ${ns}`, slug: `--turns-${ns}` },
    });
    organizationId = org.id;
    const team = await prisma.team.create({
      data: {
        name: `Turns Team ${ns}`,
        slug: `--turns-team-${ns}`,
        organizationId,
      },
    });
    teamId = team.id;
    const project = await prisma.project.create({
      data: {
        name: `Turns Proj ${ns}`,
        slug: `--turns-proj-${ns}`,
        teamId,
        language: "typescript",
        framework: "other",
        apiKey: `turns-key-${ns}`,
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["scenario", { projectId }],
      ["project", { id: projectId }],
      ["team", { id: teamId }],
      ["organization", { id: organizationId }],
    ]);
  });

  describe("given a scenario", () => {
    describe("when it is created and updated with a maximum turns value", () => {
      /** @scenario "The turn cap persists on scenario create and update" */
      it("stores the value, and clearing it stores null again", async () => {
        const service = ScenarioService.create(prisma);
        const created = await service.create({
          projectId,
          name: `Scenario ${ns}`,
          situation: "User asks for a refund",
          criteria: ["Agent is polite"],
          labels: [],
        });
        // No cap until explicitly chosen.
        expect(created.maxTurns).toBeNull();

        const updated = await service.update(created.id, projectId, {
          maxTurns: 3,
        });
        expect(updated.maxTurns).toBe(3);

        const reread = await prisma.scenario.findFirst({
          where: { id: created.id, projectId },
        });
        expect(reread?.maxTurns).toBe(3);

        const cleared = await service.update(created.id, projectId, {
          maxTurns: null,
        });
        expect(cleared.maxTurns).toBeNull();

        const rereadCleared = await prisma.scenario.findFirst({
          where: { id: created.id, projectId },
        });
        expect(rereadCleared?.maxTurns).toBeNull();
      });
    });

    describe("when it is updated without touching the maximum turns field", () => {
      /** @scenario "The turn cap persists on scenario create and update" */
      it("keeps the stored value", async () => {
        const service = ScenarioService.create(prisma);
        const created = await service.create({
          projectId,
          name: `Scenario omit ${ns}`,
          situation: "User asks a question",
          criteria: ["Agent answers"],
          labels: [],
          maxTurns: 3,
        });
        expect(created.maxTurns).toBe(3);

        // maxTurns absent from the update: undefined is a no-op in Prisma,
        // so the cap must survive a rename.
        const renamed = await service.update(created.id, projectId, {
          name: `Scenario omit renamed ${ns}`,
        });
        expect(renamed.name).toBe(`Scenario omit renamed ${ns}`);
        expect(renamed.maxTurns).toBe(3);

        const reread = await prisma.scenario.findFirst({
          where: { id: created.id, projectId },
        });
        expect(reread?.maxTurns).toBe(3);
      });
    });

    describe("when it is created with a maximum turns value", () => {
      /** @scenario "The turn cap persists on scenario create and update" */
      it("stores the value on create", async () => {
        const service = ScenarioService.create(prisma);
        const created = await service.create({
          projectId,
          name: `Scenario create ${ns}`,
          situation: "User asks a question",
          criteria: ["Agent answers"],
          labels: [],
          maxTurns: 5,
        });
        expect(created.maxTurns).toBe(5);

        const reread = await prisma.scenario.findFirst({
          where: { id: created.id, projectId },
        });
        expect(reread?.maxTurns).toBe(5);
      });
    });
  });
});
