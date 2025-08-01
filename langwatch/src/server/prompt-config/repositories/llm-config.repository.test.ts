import { type PrismaClient } from "@prisma/client";
import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  beforeAll,
  afterAll,
} from "vitest";

import { LATEST_SCHEMA_VERSION } from "./llm-config-version-schema";
import { LlmConfigRepository } from "./llm-config.repository";

import {
  llmPromptConfigFactory,
  llmPromptConfigVersionFactory,
} from "~/factories/llm-config.factory";

describe("LlmConfigRepository", () => {
  let prisma: PrismaClient;
  let repository: LlmConfigRepository;
  const realConsole = console.error;

  beforeAll(() => {
    console.error = vi.fn();
  });

  afterAll(() => {
    console.error = realConsole;
  });

  beforeEach(() => {
    // Create a manual mock of PrismaClient with the required methods
    prisma = {
      llmPromptConfig: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;
    repository = new LlmConfigRepository(prisma);
  });

  describe("getAllWithLatestVersion", () => {
    it("should return valid configs with latest versions", async () => {
      // Arrange
      const projectId = "test-project";
      const mockConfigs = [
        llmPromptConfigFactory.build({
          versions: [
            llmPromptConfigVersionFactory.build({
              schemaVersion: LATEST_SCHEMA_VERSION,
            }),
          ],
        }),
      ];

      // Use vi.fn() to properly mock the Prisma method
      prisma.llmPromptConfig.findMany = vi.fn().mockResolvedValue(mockConfigs);

      // Act
      const result = await repository.getAllWithLatestVersion(projectId);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(mockConfigs[0]?.id);
      expect(result[0]?.latestVersion).toBeDefined();
    });

    it("should filter out configs with invalid versions", async () => {
      // Arrange
      const projectId = "test-project";
      const mockConfigs = [
        llmPromptConfigFactory.build({
          versions: [
            llmPromptConfigVersionFactory.build({
              schemaVersion: "invalid-version",
            }),
          ],
        }),
        llmPromptConfigFactory.build({
          versions: [
            llmPromptConfigVersionFactory.build({
              schemaVersion: LATEST_SCHEMA_VERSION,
            }),
          ],
        }),
      ];

      // Use vi.fn() to properly mock the Prisma method
      prisma.llmPromptConfig.findMany = vi.fn().mockResolvedValue(mockConfigs);

      // Act
      const result = await repository.getAllWithLatestVersion(projectId);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(mockConfigs[1]?.id);
    });

    it("should filter out configs with no versions", async () => {
      // Arrange
      const projectId = "test-project";
      const mockConfigs = [
        llmPromptConfigFactory.build({
          versions: [
            llmPromptConfigVersionFactory.build({
              schemaVersion: LATEST_SCHEMA_VERSION,
            }),
          ],
        }),
        llmPromptConfigFactory.build({
          versions: [],
        }),
        llmPromptConfigFactory.build({
          versions: [],
        }),
      ];

      // Use vi.fn() to properly mock the Prisma method
      prisma.llmPromptConfig.findMany = vi.fn().mockResolvedValue(mockConfigs);

      // Act
      const result = await repository.getAllWithLatestVersion(projectId);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(mockConfigs[0]?.id);
    });
  });
});
