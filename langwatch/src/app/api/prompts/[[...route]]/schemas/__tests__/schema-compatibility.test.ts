import { describe, it, expect } from "vitest";

import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";
import { apiResponsePromptWithVersionDataSchema } from "../outputs";

describe("Schema compatibility", () => {
  describe("when storage schema allows defaults", () => {
    it("output schema accepts storage schema defaults", () => {
      const storageSchema = getLatestConfigVersionSchema();

      const storageData = storageSchema.parse({
        id: "version_123",
        projectId: "project_123",
        configId: "config_123",
        schemaVersion: "1.0",
        commitMessage: "initial",
        version: 1,
        createdAt: new Date(),
        configData: {
          prompt: "",
          model: "gpt-4",
          outputs: [{ identifier: "out", type: "str" }],
        },
      });

      const apiResponse = {
        id: "config_123",
        handle: "test",
        scope: "PROJECT" as const,
        name: "Test",
        updatedAt: new Date(),
        projectId: storageData.projectId,
        organizationId: "org_123",
        versionId: storageData.id,
        version: storageData.version,
        createdAt: storageData.createdAt,
        commitMessage: storageData.commitMessage,
        authorId: null,
        ...storageData.configData,
      };

      expect(() =>
        apiResponsePromptWithVersionDataSchema.parse(apiResponse)
      ).not.toThrow();
    });
  });
});
