import { afterAll, describe, expect, it } from "vitest";
import { prismaContainmentRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

function report(filename, code) {
  return runRule(prismaContainmentRule, { code, cwd: workspace.cwd, filename });
}

describe("given a feature package file", () => {
  describe("when it imports generated Prisma outside the repository seam", () => {
    /** @scenario "Generated Prisma imported outside the seam is reported" */
    it("reports generatedPrisma", () => {
      const found = report(
        "packages/features/agent/server/src/services/agent.service.ts",
        'import { Prisma } from "@langwatch/prisma-client/generated";',
      );

      expect(found.map((e) => e.messageId)).toEqual(["generatedPrisma"]);
    });
  });

  describe("when the repository under the seam imports generated Prisma", () => {
    /** @scenario "Generated Prisma imported from the repository seam is left alone" */
    it("reports nothing", () => {
      expect(
        report(
          "packages/features/agent/server/src/repositories/prisma/agent.repository.ts",
          'import { Prisma } from "@langwatch/prisma-client/generated";',
        ),
      ).toEqual([]);
    });
  });

  describe("when a feature package imports the Prisma client root", () => {
    /** @scenario "A feature owning a Prisma connection is reported" */
    it("reports featurePrismaClient", () => {
      const found = report(
        "packages/features/agent/server/src/services/agent.service.ts",
        'import { PrismaClient } from "@langwatch/prisma-client";',
      );

      expect(found.map((e) => e.messageId)).toEqual(["featurePrismaClient"]);
    });
  });
});
