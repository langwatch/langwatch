import { afterAll, describe, expect, it } from "vitest";
import { typedPrismaSeamRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

const REPOSITORY = "packages/features/agent/server/src/repositories/prisma/agent.repository.ts";

function report(code) {
  return runRule(typedPrismaSeamRule, { code, cwd: workspace.cwd, filename: REPOSITORY });
}

describe("given a Prisma repository seam file", () => {
  describe("when it casts a value as PrismaClient", () => {
    /** @scenario "An as PrismaClient cast at the seam is reported" */
    it("reports cast", () => {
      const found = report("export const db = value as PrismaClient;");

      expect(found.map((e) => e.messageId)).toEqual(["cast"]);
    });
  });

  describe("when create takes an untyped database: object parameter", () => {
    /** @scenario "An untyped database parameter at the seam is reported" */
    it("reports databaseObject", () => {
      const found = report(
        "export class AgentRepository { static create(database: object) { return new AgentRepository(); } }",
      );

      expect(found.map((e) => e.messageId)).toEqual(["databaseObject"]);
    });
  });

  describe("when the seam is typed correctly", () => {
    /** @scenario "A correctly typed seam is left alone" */
    it("reports nothing", () => {
      expect(
        report(
          "export class AgentRepository { static create(database: PrismaClient) { return new AgentRepository(); } }",
        ),
      ).toEqual([]);
    });
  });
});
