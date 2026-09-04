/**
 * @vitest-environment node
 *
 * What a prompt tag is worth once real rows are involved: a tag can only be
 * assigned while it exists in the organization's catalogue, deleting one takes
 * its assignments with it, and a new organization starts with the two seeded
 * tags.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL (or DATABASE_URL). Skips cleanly
 * without one.
 *
 * @see specs/features/prompts/custom-prompt-tags.feature
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LlmConfigRepository } from "../../repositories/prisma/prisma.prompt.repository";
import { PromptTagAssignmentRepository } from "../../repositories/prisma/prisma.prompt-tag-assignment.repository";
import { PromptTagRepository } from "../../repositories/prisma/prisma.prompt-tag.repository";
import { PromptTagService } from "../prompt-tag.service";
import { PromptService } from "../prompt.service";
import type { PromptVersionService } from "../prompt-version.service";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const namespace = `ptags-${nanoid(8)}`;

/** Version authoring is not on any path this suite drives. */
const unusedVersions = {} as PromptVersionService;

describe.skipIf(!DB_URL)("given an organization with a prompt version to tag", () => {
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;

  const tagRepository = new PromptTagRepository(prisma);
  const tags = PromptTagService.create(tagRepository);
  const prompts = PromptService.create({
    repository: new LlmConfigRepository(prisma),
    versionService: unusedVersions,
    tagRepository: new PromptTagAssignmentRepository(prisma),
    promptTagRepository: tagRepository,
    tagService: tags,
  });

  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let configId: string;
  let versionId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: namespace, slug: `${namespace}-org` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: { name: namespace, slug: `${namespace}-team`, organizationId },
    });
    teamId = team.id;

    const project = await prisma.project.create({
      data: {
        id: `${namespace}-project`,
        name: namespace,
        slug: `${namespace}-project`,
        apiKey: `sk-lw-test-${nanoid(16)}`,
        teamId,
        language: "python",
        framework: "openai",
        personalFeatures: {},
      },
    });
    projectId = project.id;

    const config = await prisma.llmPromptConfig.create({
      data: {
        id: `${namespace}-config`,
        name: "Echo",
        projectId,
        organizationId,
        handle: `${namespace}-handle`,
      },
    });
    configId = config.id;

    const version = await prisma.llmPromptConfigVersion.create({
      data: {
        id: `${namespace}-version`,
        configId,
        projectId,
        version: 1,
        schemaVersion: "1.0",
        configData: {},
        commitMessage: "initial",
      },
    });
    versionId = version.id;

    await tags.seedForOrganization({ organizationId });
  });

  afterAll(async () => {
    await prisma.promptTagAssignment.deleteMany({ where: { projectId } });
    await prisma.promptTag.deleteMany({ where: { organizationId } });
    await prisma.llmPromptConfigVersion.deleteMany({ where: { projectId } });
    await prisma.llmPromptConfig.deleteMany({ where: { projectId } });
    await prisma.project.delete({ where: { id: projectId } });
    await prisma.team.delete({ where: { id: teamId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  describe("when a brand new organization is provisioned", () => {
    /** @scenario 'New org gets "production" and "staging" seeded' */
    it("holds a production and a staging tag in the database", async () => {
      const seeded = await tags.getAll({ organizationId });

      expect(seeded.map((tag) => tag.name)).toEqual(
        expect.arrayContaining(["production", "staging"]),
      );
    });
  });

  describe("when the organization already holds the tag being assigned", () => {
    /** @scenario "Assigning a tag that exists in the DB succeeds" */
    it("records the assignment against the version", async () => {
      const assignment = await prompts.assignTag({
        configId,
        versionId,
        tag: "production",
        projectId,
      });

      expect(assignment.versionId).toBe(versionId);
      await expect(
        prisma.promptTagAssignment.findFirst({ where: { id: assignment.id, projectId } }),
      ).resolves.not.toBeNull();
    });
  });

  describe("when the tag was deleted and created again before the assignment", () => {
    /** @scenario "Assigning a recreated tag succeeds" */
    it("records the assignment against the recreated tag", async () => {
      await tags.tryDeleteByName({ organizationId, name: "staging" });
      const recreated = await tags.create({ organizationId, name: "staging" });

      const assignment = await prompts.assignTag({
        configId,
        versionId,
        tag: "staging",
        projectId,
      });

      expect(assignment.tagId).toBe(recreated.id);
    });
  });

  describe("when a custom tag that a version carries is deleted", () => {
    /** @scenario "Deleting a custom tag cascades to assignments" */
    it("leaves the version without that assignment", async () => {
      const canary = await tags.create({ organizationId, name: "canary" });
      await prompts.assignTag({ configId, versionId, tag: "canary", projectId });

      await tags.tryDeleteByName({ organizationId, name: "canary" });

      await expect(
        prisma.promptTagAssignment.findFirst({ where: { tagId: canary.id, projectId } }),
      ).resolves.toBeNull();
    });
  });
});
