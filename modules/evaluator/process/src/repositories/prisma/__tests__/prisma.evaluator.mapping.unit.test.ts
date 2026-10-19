/**
 * @vitest-environment node
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { evaluatorSchema } from "@langwatch/evaluator-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { PrismaEvaluatorRepository } from "../prisma.evaluator.repository.ts";

const CREATED_AT = new Date("2026-08-24T00:00:00.000Z");

/** A stored row, carrying a column the contract does not name. */
const storedRow = {
  id: "evaluator_1",
  projectId: "project_1",
  name: "Exact match",
  slug: "exact-match",
  type: "evaluator",
  config: { evaluatorType: "langevals/exact_match", settings: {} },
  workflowId: null,
  copiedFromEvaluatorId: null,
  archivedAt: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  project: { id: "project_1", name: "Generated relation" },
};

function repositoryOver(row: unknown): PrismaEvaluatorRepository {
  const database: PrismaClient = prismaDouble({ evaluator: { findFirst: async () => row } });

  return PrismaEvaluatorRepository.create({ prisma: database });
}

function sourcesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts") && !file.includes("__tests__"))
    .map((file) => readFileSync(join(directory, file), "utf8"));
}

describe("evaluator persistence behind the server boundary", () => {
  describe("when the repository maps a stored row", () => {
    /** @scenario "Evaluator persistence stays behind the server boundary" */
    it("returns a value that conforms to the contract schema and carries no stored-only column", async () => {
      const found = await repositoryOver(storedRow).findById({
        id: "evaluator_1",
        projectId: "project_1",
      });

      expect(evaluatorSchema.validate(found)).toBe(true);
      expect(found).toEqual({ ...storedRow, project: undefined });
      expect(Object.keys(found ?? {})).not.toContain("project");
    });

    /** @scenario "Evaluator persistence stays behind the server boundary" */
    it("refuses a stored row whose type the contract does not name", async () => {
      await expect(
        repositoryOver({ ...storedRow, type: "retired-kind" }).findById({
          id: "evaluator_1",
          projectId: "project_1",
        }),
      ).rejects.toMatchObject({ name: "ZodError" });
    });
  });

  describe("when the package boundary is read", () => {
    /** @scenario "Evaluator persistence stays behind the server boundary" */
    it("lets no generated Prisma type into the contract, and exports no repository from the root", () => {
      const contract = sourcesUnder(
        join(import.meta.dirname, "..", "..", "..", "..", "..", "contract", "src"),
      );
      const root = readFileSync(join(import.meta.dirname, "..", "..", "..", "index.ts"), "utf8");

      expect(contract.filter((source) => /prisma-client|@prisma\//.test(source))).toEqual([]);
      expect(root).not.toMatch(/repositor/i);
    });
  });
});
