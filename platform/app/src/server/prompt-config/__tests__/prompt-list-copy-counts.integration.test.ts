/**
 * specs/prompts/prompt-list-copy-counts.feature
 *
 * The copy counts are computed from the listed prompts only. They count the
 * copies that still exist, the same set a push to copies can reach.
 */

import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { PromptService } from "../prompt.service";

describe("Feature: The prompt list reports live copy counts", () => {
  let testOrganization: Organization;
  let testTeam: Team;
  let sourceProject: Project;
  let copyProjectA: Project;
  let copyProjectB: Project;
  let service: PromptService;

  const projectIds = () => [
    sourceProject.id,
    copyProjectA.id,
    copyProjectB.id,
  ];

  beforeEach(async () => {
    testOrganization = await prisma.organization.create({
      data: {
        name: "Test Organization",
        slug: `test-org-${nanoid()}`,
      },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: testOrganization.id,
      },
    });

    sourceProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: testTeam.id,
        personalFeatures: {},
      },
    });

    copyProjectA = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: testTeam.id,
        personalFeatures: {},
      },
    });

    copyProjectB = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: testTeam.id,
        personalFeatures: {},
      },
    });

    service = new PromptService(prisma);
  });

  afterEach(async () => {
    await cleanupTestRows(prisma, [
      ["llmPromptConfigVersion", { projectId: { in: projectIds() } }],
      // Copies first: they reference their source prompt with a restricting
      // relation, so the source rows can only go once the copies are gone.
      [
        "llmPromptConfig",
        {
          projectId: { in: projectIds() },
          copiedFromPromptId: { not: null },
        },
      ],
      ["llmPromptConfig", { projectId: { in: projectIds() } }],
      ["project", { id: { in: projectIds() } }],
    ]);
    await prisma.team.delete({ where: { id: testTeam.id } });
    await prisma.organization.delete({
      where: { id: testOrganization.id },
    });
  });

  async function createSourcePrompt(handle: string) {
    return await service.createPrompt({
      projectId: sourceProject.id,
      organizationId: testOrganization.id,
      handle,
      prompt: "You are a helpful assistant",
      model: "openai/gpt-5-mini",
    });
  }

  async function listSourceProjectPrompts() {
    return await service.getAllPrompts({
      projectId: sourceProject.id,
      organizationId: testOrganization.id,
    });
  }

  describe("given a prompt with a copy in each of two other projects", () => {
    /** @scenario "A prompt with copies reports their number" */
    it("reports two copies when the prompts are listed", async () => {
      const source = await createSourcePrompt("copied-twice");
      await service.copyPrompt({
        idOrHandle: source.id,
        sourceProjectId: sourceProject.id,
        targetProjectId: copyProjectA.id,
      });
      await service.copyPrompt({
        idOrHandle: source.id,
        sourceProjectId: sourceProject.id,
        targetProjectId: copyProjectB.id,
      });

      const listed = await listSourceProjectPrompts();

      const prompt = listed.find((p) => p.id === source.id);
      expect(prompt?._count?.copiedPrompts).toBe(2);
    });
  });

  describe("given a prompt with two copies and one of them deleted", () => {
    /** @scenario "A deleted copy is not counted" */
    it("reports one copy when the prompts are listed", async () => {
      const source = await createSourcePrompt("copied-then-deleted");
      const copyA = await service.copyPrompt({
        idOrHandle: source.id,
        sourceProjectId: sourceProject.id,
        targetProjectId: copyProjectA.id,
      });
      await service.copyPrompt({
        idOrHandle: source.id,
        sourceProjectId: sourceProject.id,
        targetProjectId: copyProjectB.id,
      });
      await service.deletePrompt({
        idOrHandle: copyA.id,
        projectId: copyProjectA.id,
      });

      const listed = await listSourceProjectPrompts();

      const prompt = listed.find((p) => p.id === source.id);
      expect(prompt?._count?.copiedPrompts).toBe(1);
    });
  });

  describe("given a prompt that was never copied", () => {
    /** @scenario "A prompt without copies reports zero" */
    it("reports zero copies when the prompts are listed", async () => {
      const source = await createSourcePrompt("never-copied");

      const listed = await listSourceProjectPrompts();

      const prompt = listed.find((p) => p.id === source.id);
      expect(prompt?._count?.copiedPrompts).toBe(0);
    });
  });
});
