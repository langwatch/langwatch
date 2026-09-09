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
  it("allows native model client types only inside a Prisma repository", () => {
    const code = 'import type { PrismaModelClient } from "@langwatch/prisma-client";';

    expect(
      report("packages/features/agent/server/src/repositories/prisma/agent.repository.ts", code),
    ).toEqual([]);
    expect(
      report("packages/features/agent/server/src/services/agent.service.ts", code).map(
        (issue) => issue.messageId,
      ),
    ).toEqual(["featurePrismaClient"]);
  });

  it("rejects connection imports mixed into a repository type import", () => {
    expect(
      report(
        "packages/features/agent/server/src/repositories/prisma/agent.repository.ts",
        'import { type PrismaModelClient, PrismaConnectionService } from "@langwatch/prisma-client";',
      ).map((issue) => issue.messageId),
    ).toEqual(["featurePrismaClient"]);
  });

  it("rejects ownership type leakage through the ownership subpath", () => {
    expect(
      report(
        "packages/features/agent/server/src/services/agent.service.ts",
        'import type { ScopedPrismaClient } from "@langwatch/prisma-client/ownership";',
      ).map((issue) => issue.messageId),
    ).toEqual(["featurePrismaClient"]);
  });

  it("allows repository runtime helpers only at repository and registry seams", () => {
    expect(
      report(
        "packages/features/agent/server/src/repositories/prisma/prisma.agent.repository.ts",
        'import { PrismaRepository } from "@langwatch/prisma-client";',
      ),
    ).toEqual([]);
    expect(
      report(
        "packages/features/agent/server/src/repositories/agent-repositories.registry.ts",
        'import { prismaRepositories } from "@langwatch/prisma-client";',
      ),
    ).toEqual([]);
  });

  it("rejects repository runtime helpers outside their seams", () => {
    expect(
      report(
        "packages/features/agent/server/src/services/agent.service.ts",
        'import { PrismaRepository, prismaRepositories } from "@langwatch/prisma-client";',
      ).map((issue) => issue.messageId),
    ).toEqual(["featurePrismaClient"]);
  });

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
