/**
 * @vitest-environment node
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it } from "vitest";
import { PrismaEvaluatorRepository } from "../prisma.evaluator.repository.ts";

/** Only the `evaluator` delegate this repository declares is stood in for. */
type EvaluatorDelegate = Partial<{
  findFirst(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown[]>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
}>;

function fakeDatabase(overrides: EvaluatorDelegate = {}): {
  database: PrismaClient;
  created: Record<string, unknown>[];
} {
  const created: Record<string, unknown>[] = [];
  const evaluator = {
    findFirst: async () => null,
    findMany: async () => [],
    create: async (args: { data: Record<string, unknown> }) => {
      created.push(args.data);
      return {
        workflowId: null,
        copiedFromEvaluatorId: null,
        ...args.data,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
    update: async () => {
      throw new Error("unused");
    },
    ...overrides,
  };
  return { database: { evaluator } as unknown as PrismaClient, created };
}

const persistInput = (overrides: { id?: string; projectId?: string; name: string }) => ({
  id: overrides.id ?? "eval_1",
  projectId: overrides.projectId ?? "project_1",
  name: overrides.name,
  type: "evaluator" as const,
  config: {},
});

describe("PrismaEvaluatorRepository slug generation", () => {
  describe("given a new evaluator", () => {
    /** @scenario "Generate slug from evaluator name on creation" */
    it("generates a kebab-case slug from the evaluator name", async () => {
      const { database, created } = fakeDatabase();
      const repository = PrismaEvaluatorRepository.create({ prisma: database });

      await repository.create(persistInput({ name: "My Custom Evaluator" }));

      expect(created[0]?.slug).toBe("my-custom-evaluator");
    });

    /** @scenario "Handle special characters in name" */
    it("strips special characters down to lowercase letters, numbers and hyphens", async () => {
      const { database, created } = fakeDatabase();
      const repository = PrismaEvaluatorRepository.create({ prisma: database });

      await repository.create(persistInput({ name: "LLM Judge (v2.0) - Beta!" }));

      expect(created[0]?.slug).toMatch(/^[a-z0-9-]+$/);
      expect(created[0]?.slug).toBe("llm-judge-v2-0-beta");
    });

    /** @scenario "Handle unicode characters in name" */
    it("collapses non-alphanumeric unicode characters to hyphens rather than crashing", async () => {
      const { database, created } = fakeDatabase();
      const repository = PrismaEvaluatorRepository.create({ prisma: database });

      await repository.create(persistInput({ name: "Säfety Check" }));

      expect(created[0]?.slug).toMatch(/^[a-z0-9-]+$/);
    });

    /** @scenario "Handle very long names" */
    it("does not reject a very long name — the slug carries its full length", async () => {
      const { database, created } = fakeDatabase();
      const repository = PrismaEvaluatorRepository.create({ prisma: database });
      const longName = "A".repeat(200);

      await repository.create(persistInput({ name: longName }));

      expect(created[0]?.slug).toBe("a".repeat(200));
    });

    /** @scenario "Handle empty or whitespace-only names" */
    it("falls back to the literal 'evaluator' slug for a whitespace-only name", async () => {
      const { database, created } = fakeDatabase();
      const repository = PrismaEvaluatorRepository.create({ prisma: database });

      await repository.create(persistInput({ name: "   " }));

      expect(created[0]?.slug).toBe("evaluator");
    });
  });

  describe("given two evaluators with the same name in the same project", () => {
    /** @scenario "Slug uniqueness within project" */
    it("retries create on a slug unique-constraint violation", async () => {
      let attempts = 0;
      const { database, created } = fakeDatabase({
        create: async (args: { data: Record<string, unknown> }) => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("Unique constraint failed on the fields: (`slug`)");
          }
          created.push(args.data);
          return {
            workflowId: null,
            copiedFromEvaluatorId: null,
            ...args.data,
            archivedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        },
      });
      const repository = PrismaEvaluatorRepository.create({ prisma: database });

      const result = await repository.create(persistInput({ name: "Exact Match" }));

      expect(attempts).toBe(2);
      expect(result.slug).toBe("exact-match");
    });
  });

  describe("given the same evaluator name used in two different projects", () => {
    /** @scenario "Same name allowed in different projects" */
    it("generates the same slug for each project without either create failing", async () => {
      const { database, created } = fakeDatabase();
      const repository = PrismaEvaluatorRepository.create({ prisma: database });

      await repository.create(
        persistInput({ id: "eval_1", projectId: "proj1", name: "Exact Match" }),
      );
      await repository.create(
        persistInput({ id: "eval_2", projectId: "proj2", name: "Exact Match" }),
      );

      expect(created[0]?.slug).toBe("exact-match");
      expect(created[1]?.slug).toBe("exact-match");
    });
  });

  describe("given a unique-constraint violation on a different column", () => {
    /** @scenario "Retry on unique constraint violation" */
    it("does not retry and rethrows the original error", async () => {
      const { database } = fakeDatabase({
        create: async () => {
          throw new Error("Unique constraint failed on the fields: (`id`)");
        },
      });
      const repository = PrismaEvaluatorRepository.create({ prisma: database });

      await expect(repository.create(persistInput({ name: "Conflict" }))).rejects.toThrow(
        /\(`id`\)/,
      );
    });
  });
});
