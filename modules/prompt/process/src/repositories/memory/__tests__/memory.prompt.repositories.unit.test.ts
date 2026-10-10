import { SchemaVersion } from "@langwatch/prompt-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryPromptRepositories } from "../memory.prompt.repositories.ts";

describe("MemoryPromptRepositories", () => {
  it("keeps versions and tag assignments in one scoped prompt store", async () => {
    const repositories = MemoryPromptRepositories.create();
    const created = await repositories.configs.createConfigWithInitialVersion({
      defaultModel: "openai/gpt-5-mini",
      configData: {
        name: "Support triage",
        projectId: "project-source",
        organizationId: "organization-1",
        handle: "support-triage",
        scope: "ORGANIZATION",
        copiedFromPromptId: null,
      },
    });
    const initialVersionId = created.latestVersion.id;
    if (!initialVersionId) throw new Error("Expected the initial prompt version");

    const tag = await repositories.tags.create({
      organizationId: "organization-1",
      name: "staging",
    });
    await repositories.tagAssignments.assignTag({
      configId: created.id,
      versionId: initialVersionId,
      tagId: tag.id,
      projectId: "project-source",
    });

    const updated = await repositories.configs.updateConfigAndCreateVersion({
      idOrHandle: created.id,
      projectId: "project-source",
      data: {},
      commitMessage: "Changed instructions",
      configDataUpdates: { prompt: "Answer concisely" },
      schemaVersion: SchemaVersion.V1_0,
    });
    const updatedVersionId = updated.latestVersion.id;
    if (!updatedVersionId) throw new Error("Expected the updated prompt version");

    await repositories.tagAssignments.assignTag({
      configId: created.id,
      versionId: updatedVersionId,
      tagId: tag.id,
      projectId: "project-source",
    });

    await repositories.tags.rename({
      organizationId: "organization-1",
      oldName: "staging",
      newName: "release",
    });

    await expect(
      repositories.tagAssignments.findTagsForConfig({
        configId: created.id,
        projectId: "project-source",
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          promptTag: expect.objectContaining({ name: "release" }),
        }),
      ]),
    );
    await expect(
      repositories.tagAssignments.findByVersionIds({
        versionIds: [initialVersionId, updatedVersionId],
        projectId: "project-source",
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          promptTag: expect.objectContaining({ name: "release" }),
        }),
      ]),
    );

    await expect(
      repositories.configs.findConfigByIdOrHandleWithLatestVersion({
        idOrHandle: "support-triage",
        projectId: "project-reader",
        organizationId: "organization-1",
      }),
    ).resolves.toMatchObject({
      id: created.id,
      handle: "support-triage",
      latestVersion: { id: updatedVersionId },
    });
    await expect(
      repositories.tagAssignments.findByConfigAndTagId({
        configId: created.id,
        tagId: tag.id,
        projectId: "project-source",
      }),
    ).resolves.toMatchObject({ versionId: updatedVersionId });

    await repositories.configs.deleteConfig({
      idOrHandle: created.id,
      projectId: "project-source",
      organizationId: "organization-1",
    });

    await expect(
      repositories.configs.findAllWithLatestVersion({
        projectId: "project-reader",
        organizationId: "organization-1",
      }),
    ).resolves.toEqual([]);
  });

  it("increments versions by the maximum stored number at one timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T00:00:00.000Z"));

    try {
      const repositories = MemoryPromptRepositories.create();
      const created = await repositories.configs.createConfigWithInitialVersion({
        defaultModel: "openai/gpt-5-mini",
        configData: {
          name: "Support triage",
          projectId: "project-source",
          organizationId: "organization-1",
          handle: "support-triage",
          scope: "PROJECT",
          copiedFromPromptId: null,
        },
      });

      const versionData = {
        configId: created.id,
        projectId: "project-source",
        authorId: null,
        commitMessage: "Changed instructions",
        schemaVersion: SchemaVersion.V1_0,
        configData: created.latestVersion.configData,
      };
      const first = await repositories.configs.versions.createVersion({
        versionData,
        organizationId: "organization-1",
      });
      const second = await repositories.configs.versions.createVersion({
        versionData,
        organizationId: "organization-1",
      });

      expect(first.version).toBe(2);
      expect(second.version).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
