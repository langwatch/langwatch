/**
 * The usage report's prompt figures, over the memory twin.
 * Spec: specs/self-hosting/connected-services/usage-report.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryPromptRepositories } from "../memory.prompt.repositories.ts";

const config = (projectId: string, handle: string) => ({
  configData: {
    name: handle,
    projectId,
    organizationId: "organization-1",
    handle,
    scope: "PROJECT" as const,
    copiedFromPromptId: null,
  },
  defaultModel: "openai/gpt-5-mini",
});

describe("given prompts across the install", () => {
  describe("when the usage report counts them", () => {
    it("counts the named projects only and dates the first", async () => {
      const repositories = MemoryPromptRepositories.create();
      await repositories.configs.createConfigWithInitialVersion(config("p1", "first"));
      await repositories.configs.createConfigWithInitialVersion(config("p1", "second"));
      await repositories.configs.createConfigWithInitialVersion(config("other", "third"));

      const counted = await repositories.configs.countUsage({ projectIds: ["p1"] });
      const later = await repositories.configs.countUsage({
        projectIds: ["p1"],
        since: Date.now() + 60_000,
      });

      expect(counted.prompts).toBe(2);
      expect(counted.firstPromptAt).toBeTypeOf("number");
      expect(later.prompts).toBe(0);
    });
  });
});
