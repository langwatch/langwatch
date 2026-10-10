/**
 * Prompt version ids: new versions mint `promptversion` KSUIDs, and a version
 * stored under the older nanoid format still reads back by its id.
 */
import { describe, expect, it } from "vitest";

import { MemoryLlmConfigRepository } from "../memory.prompt.repository.ts";
import { MemoryPromptState } from "../memory.prompt.store.ts";

const PROJECT = "project-1";

async function createPrompt() {
  const state = new MemoryPromptState();
  const configs = MemoryLlmConfigRepository.create(state);
  const created = await configs.createConfigWithInitialVersion({
    defaultModel: "openai/gpt-5-mini",
    configData: {
      name: "Support triage",
      projectId: PROJECT,
      organizationId: "organization-1",
      handle: "support-triage",
      scope: "PROJECT",
      copiedFromPromptId: null,
    },
  });
  return { state, configs, created };
}

describe("prompt version ids", () => {
  describe("when a new version is created", () => {
    it("mints a promptversion KSUID", async () => {
      const { created } = await createPrompt();

      expect(created.latestVersion.id).toMatch(/^promptversion_[a-zA-Z0-9]+$/);
    });
  });

  describe("given a version stored under the older nanoid id format", () => {
    it("still reads back by that id", async () => {
      const { state, configs, created } = await createPrompt();
      const stored = state.versions.get(created.latestVersion.id ?? "");
      if (!stored) throw new Error("Expected the initial version in the store");
      const legacyId = "prompt_version_V1StGXR8_Z5jdHi6B-myT";
      state.versions.set(legacyId, { ...stored, id: legacyId });

      const read = await configs.versions.findVersionById({
        versionId: legacyId,
        projectId: PROJECT,
      });

      expect(read.id).toBe(legacyId);
      expect(read.configId).toBe(created.id);
    });
  });
});
