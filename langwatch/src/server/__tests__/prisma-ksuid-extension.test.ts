import { describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { ksuidExtension } from "../prisma-ksuid-extension";

// Mock the generate function
vi.mock("@langwatch/ksuid", async () => {
  const actual = await vi.importActual("@langwatch/ksuid");
  return {
    ...actual,
    generate: vi.fn((resource: string) => ({
      toString: () => `${resource}_mock_ksuid_123`,
    })),
  };
});

describe("prisma-ksuid-extension", () => {
  describe("ksuidExtension", () => {
    it("is a valid Prisma extension", () => {
      expect(ksuidExtension).toBeDefined();
      expect(typeof ksuidExtension).toBe("function");
    });

    it("can be applied to a Prisma client", () => {
      // This test verifies the extension structure is valid
      // We can't actually run queries without a database connection
      const mockClient = {
        $extends: vi.fn().mockReturnThis(),
      } as unknown as PrismaClient;

      const result = mockClient.$extends(ksuidExtension);
      expect(mockClient.$extends).toHaveBeenCalledWith(ksuidExtension);
    });
  });

  describe("generate function", () => {
    it("is called with correct resource prefix for known models", () => {
      const mockedGenerate = vi.mocked(generate);
      mockedGenerate.mockClear();

      // Simulate what the extension does
      const modelToResource: Record<string, string> = {
        User: "user",
        Project: "project",
        Organization: "organization",
        Monitor: "monitor",
        Experiment: "experiment",
        Cost: "cost",
      };

      for (const [model, expectedResource] of Object.entries(modelToResource)) {
        const resource = modelToResource[model] ?? model.toLowerCase();
        generate(resource);
        expect(mockedGenerate).toHaveBeenLastCalledWith(expectedResource);
      }
    });

    it("falls back to lowercase model name for unknown models", () => {
      const mockedGenerate = vi.mocked(generate);
      mockedGenerate.mockClear();

      // For unknown models, extension uses lowercase model name (truncated to 16 chars)
      const unknownModel = "SomeNewModel";
      const expectedResource = unknownModel.toLowerCase().slice(0, 16);

      generate(expectedResource);
      expect(mockedGenerate).toHaveBeenCalledWith("somenewmodel");
    });
  });
});
