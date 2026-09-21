import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  llmPromptConfigFactory,
  llmPromptConfigVersionFactory,
} from "~/factories/llm-config.factory";
import type { PrismaClient } from "~/generated/prisma/client";
import { LlmConfigRepository } from "./llm-config.repository";
import { LATEST_SCHEMA_VERSION } from "./llm-config-version-schema";

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
        groupBy: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;
    repository = new LlmConfigRepository(prisma);
  });

  describe("getAllWithLatestVersion", () => {
    it("returns valid configs with latest versions", async () => {
      // Arrange
      const projectId = "test-project";
      const organizationId = "test-organization";
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
      const result = await repository.getAllWithLatestVersion({
        projectId,
        organizationId,
      });

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(mockConfigs[0]?.id);
      expect(result[0]?.latestVersion).toBeDefined();
    });

    it("filters out configs with invalid versions", async () => {
      // Arrange
      const projectId = "test-project";
      const organizationId = "test-organization";
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
      const result = await repository.getAllWithLatestVersion({
        projectId,
        organizationId,
      });

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(mockConfigs[1]?.id);
    });

    it("filters out configs with no versions", async () => {
      // Arrange
      const projectId = "test-project";
      const organizationId = "test-organization";
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
      const result = await repository.getAllWithLatestVersion({
        projectId,
        organizationId,
      });

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(mockConfigs[0]?.id);
    });

    describe("when the listed prompts have copies", () => {
      it("reports the number of copies of each prompt", async () => {
        const mockConfigs = [
          llmPromptConfigFactory.build({
            versions: [
              llmPromptConfigVersionFactory.build({
                schemaVersion: LATEST_SCHEMA_VERSION,
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
        prisma.llmPromptConfig.findMany = vi
          .fn()
          .mockResolvedValue(mockConfigs);
        prisma.llmPromptConfig.groupBy = vi.fn().mockResolvedValue([
          {
            copiedFromPromptId: mockConfigs[0]!.id,
            _count: { _all: 2 },
          },
        ]);

        const result = await repository.getAllWithLatestVersion({
          projectId: "test-project",
          organizationId: "test-organization",
        });

        expect(result[0]?._count?.copiedPrompts).toBe(2);
        expect(result[1]?._count?.copiedPrompts).toBe(0);
      });

      it("counts only live copies of the listed prompts", async () => {
        const mockConfigs = [
          llmPromptConfigFactory.build({
            versions: [
              llmPromptConfigVersionFactory.build({
                schemaVersion: LATEST_SCHEMA_VERSION,
              }),
            ],
          }),
        ];
        prisma.llmPromptConfig.findMany = vi
          .fn()
          .mockResolvedValue(mockConfigs);

        await repository.getAllWithLatestVersion({
          projectId: "test-project",
          organizationId: "test-organization",
        });

        // The prompt ids come from the listed rows, which the query above
        // already scoped to the caller. That id list is what bounds the count,
        // so it never reads a prompt the caller cannot list.
        expect(prisma.llmPromptConfig.groupBy).toHaveBeenCalledWith(
          expect.objectContaining({
            by: ["copiedFromPromptId"],
            where: {
              copiedFromPromptId: { in: [mockConfigs[0]!.id] },
              deletedAt: null,
            },
          }),
        );
      });
    });

    describe("when no prompt is listed", () => {
      it("asks the database for no counts", async () => {
        prisma.llmPromptConfig.findMany = vi.fn().mockResolvedValue([]);

        const result = await repository.getAllWithLatestVersion({
          projectId: "test-project",
          organizationId: "test-organization",
        });

        expect(result).toHaveLength(0);
        expect(prisma.llmPromptConfig.groupBy).not.toHaveBeenCalled();
      });
    });
  });
});
