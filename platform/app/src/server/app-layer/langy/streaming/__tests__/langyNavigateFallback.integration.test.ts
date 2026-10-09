/**
 * The navigate fallback against REAL services: a prompt seeded through the
 * platform's own PromptService resolves to the prompts-page drawer address,
 * scoped to the project that owns it. This is the reported failure end to
 * end minus the relay: `langwatch navigate open prompt_<id>` for a prompt the
 * project can see must produce a platform-computed address, and the same id
 * under a different project must produce nothing.
 *
 * @see specs/langy/langy-agent-driven-navigation.feature
 */
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { ProjectService } from "~/server/app-layer/projects/project.service";
import { PrismaProjectRepository } from "~/server/app-layer/projects/repositories/project.prisma.repository";
import { prisma } from "~/server/db";
import { PromptService } from "~/server/prompt-config/prompt.service";
import { resolveNavigateFallbackUrl } from "../langyNavigateFallback";

describe("Feature: the navigate fallback resolves a prompt with the project's own access", () => {
  let organization: Organization;
  let team: Team;
  let project: Project;
  let otherProject: Project;

  beforeEach(async () => {
    await resetApp();

    organization = await prisma.organization.create({
      data: { name: "Test Organization", slug: `test-org-${nanoid()}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `navfix-${nanoid()}` }),
        teamId: team.id,
        personalFeatures: {},
      },
    });
    otherProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `navfix-other-${nanoid()}` }),
        teamId: team.id,
        personalFeatures: {},
      },
    });

    globalForApp.__langwatch_app = createTestApp({
      projects: new ProjectService(new PrismaProjectRepository(prisma)),
    });
  });

  afterEach(async () => {
    // Guarded on what setup actually created: a create that threw part-way
    // leaves the later rows undefined, and deleting by an undefined id throws
    // an error that hides the real setup failure.
    const projectIds = [project?.id, otherProject?.id].filter(
      (id): id is string => typeof id === "string",
    );
    if (projectIds.length > 0) {
      await prisma.llmPromptConfigVersion.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await prisma.llmPromptConfig.deleteMany({
        where: { projectId: { in: projectIds } },
      });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }
    if (team?.id) await prisma.team.deleteMany({ where: { id: team.id } });
    if (organization?.id) {
      await prisma.organization.deleteMany({ where: { id: organization.id } });
    }
  });

  describe("when the agent asks to open a prompt the project can see", () => {
    it("resolves the prompts-page drawer address for that prompt", async () => {
      const prompt = await new PromptService(prisma).createPrompt({
        projectId: project.id,
        organizationId: organization.id,
        handle: `navfix-prompt-${nanoid().toLowerCase()}`,
        prompt: "You are a helpful assistant.",
        model: "openai/gpt-5-mini",
      });

      const url = await resolveNavigateFallbackUrl({
        projectId: project.id,
        resourceId: prompt.id,
      });

      // BASE_HOST is deployment config; what this pins is the PATH the
      // platform addresses (same reasoning as
      // simulation-run-platform-url.integration.test.ts).
      expect(url).toContain(`/${project.slug}/prompts?promptId=${prompt.id}`);
    });
  });

  describe("when the id does not resolve in the asking project", () => {
    it("returns null for another project's prompt id", async () => {
      const prompt = await new PromptService(prisma).createPrompt({
        projectId: project.id,
        organizationId: organization.id,
        handle: `navfix-prompt-${nanoid().toLowerCase()}`,
        prompt: "You are a helpful assistant.",
        model: "openai/gpt-5-mini",
      });

      expect(
        await resolveNavigateFallbackUrl({
          projectId: otherProject.id,
          resourceId: prompt.id,
        }),
      ).toBeNull();
    });

    it("returns null for a prompt id that exists nowhere", async () => {
      expect(
        await resolveNavigateFallbackUrl({
          projectId: project.id,
          resourceId: `prompt_${nanoid()}`,
        }),
      ).toBeNull();
    });
  });

  describe("when the agent asks to open a page rather than one resource", () => {
    /** @scenario A page name navigates to the project's own page */
    it("resolves a page name to the project's own page address", async () => {
      const url = await resolveNavigateFallbackUrl({
        projectId: project.id,
        resourceId: "prompts",
      });
      expect(url).toContain(`/${project.slug}/prompts`);

      expect(
        await resolveNavigateFallbackUrl({
          projectId: project.id,
          resourceId: "online-evaluations",
        }),
      ).toContain(`/${project.slug}/online-evaluations`);
    });

    /** @scenario A name outside the page set is not a destination */
    it("returns null for a word that is neither a page nor a resolvable id", async () => {
      expect(
        await resolveNavigateFallbackUrl({
          projectId: project.id,
          resourceId: "settings",
        }),
      ).toBeNull();
    });
  });
});
