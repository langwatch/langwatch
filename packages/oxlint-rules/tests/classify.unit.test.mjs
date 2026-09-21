import { afterAll, describe, expect, it } from "vitest";
import { classify, resetClassificationCache } from "../src/classify.mjs";
import { createFixtureWorkspace } from "../src/testing.mjs";

// The five helpers this replaces, and the question each one asked:
//   normalizedFilename    -> `filename`
//   classifyFile          -> `role`, `feature`, `enterprise`, `relative`
//   prismaPackageOf       -> `kind`, `sourcePath`
//   isStrictServiceModule -> `isServiceModule`
//   strictFeatureSource   -> `strictSource`
// plus the inline seam regexes of `typed-prisma-seam` -> `isPrismaSeam`.

const workspace = createFixtureWorkspace({
  features: {
    agent: { roles: { contract: {}, process: {}, browser: {} } },
  },
});

afterAll(() => workspace.cleanup());

function classifyPath(workspacePath) {
  resetClassificationCache();

  return classify({ cwd: workspace.cwd, filename: workspacePath, physicalFilename: undefined });
}

const CASES = [
  {
    path: "modules/agent/process/src/services/agent.service.ts",
    expected: {
      role: "process",
      kind: "process",
      feature: "agent",
      enterprise: false,
      relative: "src/services/agent.service.ts",
      sourcePath: "services/agent.service.ts",
      isTest: false,
      isServiceModule: true,
      isPrismaSeam: false,
      strictSource: {
        enterprise: false,
        feature: "agent",
        name: "agent.service.ts",
        role: "process",
        sourcePath: "services/agent.service.ts",
      },
    },
  },
  {
    path: "modules/agent/contract/src/agent.commands.ts",
    expected: {
      role: "contract",
      kind: "contract",
      feature: "agent",
      relative: "src/agent.commands.ts",
      sourcePath: "agent.commands.ts",
      isServiceModule: false,
      strictSource: {
        enterprise: false,
        feature: "agent",
        name: "agent.commands.ts",
        role: "contract",
        sourcePath: "agent.commands.ts",
      },
    },
  },
  {
    path: "modules/agent/process/src/repositories/prisma/agent.repository.ts",
    expected: { role: "process", kind: "process", isPrismaSeam: true, isServiceModule: false },
  },
  {
    path: "modules/agent/process/src/adapters/postgres.agent.adapter.ts",
    expected: { role: "process", isPrismaSeam: true },
  },
  {
    path: "modules/agent/process/src/adapters/redis.agent.adapter.ts",
    expected: { role: "process", isPrismaSeam: false },
  },
  {
    path: "modules/agent/process/src/services/__tests__/agent.service.unit.test.ts",
    expected: { role: "process", isTest: true, isProduction: false, strictSource: undefined },
  },
  {
    path: "modules/agent/process/tests/wiring.integration.test.ts",
    expected: {
      role: "process",
      relative: "tests/wiring.integration.test.ts",
      sourcePath: undefined,
      isTest: true,
    },
  },
  {
    path: "modules/agent/process/package.json",
    expected: { role: "other", kind: undefined, feature: undefined, relative: undefined },
  },
  {
    path: "apps/api/src/features/agent/agent.composition.ts",
    expected: {
      role: "other",
      kind: "application",
      relative: "src/features/agent/agent.composition.ts",
      sourcePath: "features/agent/agent.composition.ts",
    },
  },
  {
    path: "apps/langy/src/index.ts",
    expected: { role: "other", kind: undefined, sourcePath: undefined },
  },
  {
    path: "enterprise/packages/composition/api/src/wiring.ts",
    expected: { role: "other", kind: "enterprise-composition", sourcePath: "wiring.ts" },
  },
  {
    path: "packages/config/src/env.ts",
    expected: { role: "config", kind: "config", sourcePath: "env.ts" },
  },
  {
    path: "packages/design-system/src/button.tsx",
    expected: { role: "design-system", kind: "design-system", sourcePath: "button.tsx" },
  },
  {
    path: "packages/eventing/src/bus.ts",
    expected: { role: "framework", kind: undefined, sourcePath: undefined },
  },
  {
    path: "packages/architecture-enforcer/src/cli.ts",
    expected: { role: "other", kind: undefined },
  },
];

describe("given the one classification every rule gates on", () => {
  describe("when it is asked about a path", () => {
    for (const testCase of CASES) {
      it(`classifies ${testCase.path}`, () => {
        expect(classifyPath(testCase.path)).toMatchObject(testCase.expected);
      });
    }
  });

  describe("when the path is enterprise", () => {
    it("carries the enterprise flag", () => {
      const file = classifyPath(
        "enterprise/modules/governance/process/src/services/governance.service.ts",
      );

      expect(file).toMatchObject({
        enterprise: true,
        feature: "governance",
        isServiceModule: true,
        role: "process",
      });
    });
  });

  describe("when the same file is classified twice", () => {
    it("returns the memoised object rather than recomputing it", () => {
      resetClassificationCache();
      const context = { cwd: workspace.cwd, filename: "modules/agent/process/src/x.ts" };

      expect(classify(context)).toBe(classify(context));
    });
  });

  describe("when the filename is already absolute", () => {
    it("reports the workspace path relative to the linter's root", () => {
      resetClassificationCache();
      const file = classify({
        cwd: workspace.cwd,
        filename: `${workspace.cwd}/modules/agent/process/src/services/agent.service.ts`,
      });

      expect(file.workspacePath).toBe(
        "modules/agent/process/src/services/agent.service.ts",
      );
    });
  });
});
