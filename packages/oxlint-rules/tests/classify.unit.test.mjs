import { afterAll, describe, expect, it } from "vitest";

import {
  classify,
  modulePackageOf,
  modulePackages,
  resetClassificationCache,
} from "../src/classify.mjs";
import { createFixtureWorkspace } from "../src/testing.mjs";

// Replaces normalizedFilename, classifyFile, prismaPackageOf, isStrictServiceModule,
// strictFeatureSource and typed-prisma-seam's inline seam regexes.

const workspace = createFixtureWorkspace({
  features: {
    agent: { roles: { contract: {}, process: {}, browser: {}, "query-language": {} } },
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
      layer: "services",
      module: "agent",
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
    path: "modules/agent/process/src/features/billing/services/billing.service.ts",
    expected: { role: "process", layer: "services", isServiceModule: true },
  },
  {
    path: "modules/agent/process/src/features/billing/repositories/prisma/prisma.billing.repository.ts",
    expected: { role: "process", layer: "repositories", isPrismaSeam: true },
  },
  {
    path: "modules/agent/process/src/adapters/postgres.agent.adapter.ts",
    expected: { role: "process", isPrismaSeam: false, layer: undefined },
  },
  {
    path: "modules/agent/process/src/channels/memory/agent-mail.channel.ts",
    expected: { role: "process", layer: "channels", module: "agent", moduleEnterprise: false },
  },
  {
    path: "modules/agent/query-language/src/parse.ts",
    expected: {
      role: "library",
      kind: "library",
      feature: "agent",
      module: "agent",
      relative: "src/parse.ts",
      sourcePath: "parse.ts",
      layer: undefined,
      strictSource: undefined,
    },
  },
  {
    path: "modules/agent/specs/agent.feature",
    expected: { role: "other", kind: undefined, module: undefined },
  },
  {
    path: "modules/agent/process/vitest.config.ts",
    expected: { role: "other", feature: undefined, module: "agent" },
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
    expected: { role: "other", kind: undefined, module: undefined, sourcePath: undefined },
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
        module: "governance",
        moduleEnterprise: true,
        role: "process",
      });
    });
  });

  describe("when it is asked for the workspace's module packages", () => {
    it("finds every role's package by name, the enterprise mirror included", () => {
      const fixture = createFixtureWorkspace({
        features: { trace: { roles: { contract: {}, browser: {}, "query-language": {} } } },
        files: {
          "enterprise/modules/sso/process/package.json": JSON.stringify({
            name: "@langwatch/enterprise-sso-process",
            exports: { ".": ".", "./testing": "./testing" },
          }),
        },
      });
      resetClassificationCache();

      try {
        expect(modulePackageOf(fixture.cwd, "@langwatch/trace-browser")?.pkg).toMatchObject({
          enterprise: false,
          module: "trace",
          role: "browser",
          root: "modules/trace/browser",
        });
        expect(
          modulePackageOf(fixture.cwd, "@langwatch/enterprise-sso-process/testing"),
        ).toMatchObject({
          pkg: { enterprise: true, module: "sso", role: "process" },
          subpath: "./testing",
        });
        expect(modulePackageOf(fixture.cwd, "@langwatch/trace-query-language")?.pkg).toMatchObject({
          module: "trace",
          role: "library",
          root: "modules/trace/query-language",
        });
        expect(modulePackageOf(fixture.cwd, "zod")).toBeUndefined();
        expect(
          [...modulePackages(fixture.cwd).keys()].toSorted((a, b) => a.localeCompare(b)),
        ).toEqual([
          "@langwatch/enterprise-sso-process",
          "@langwatch/trace-browser",
          "@langwatch/trace-contract",
          "@langwatch/trace-query-language",
        ]);
      } finally {
        fixture.cleanup();
      }
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

      expect(file.workspacePath).toBe("modules/agent/process/src/services/agent.service.ts");
    });
  });
});

// ADR-181: a framework package opts into the feature layout in its own package.json.
const frameworkWorkspace = createFixtureWorkspace({
  files: {
    "packages/eventing/package.json": JSON.stringify({
      name: "@langwatch/eventing",
      exports: {
        ".": { types: "./dist/index.d.ts", default: "./src/index.ts" },
        "./server": { types: "./dist/server/index.d.ts", default: "./src/server/index.ts" },
      },
      langwatch: { group: "framework", layout: "features" },
    }),
    "packages/group-queue/package.json": JSON.stringify({
      name: "@langwatch/group-queue",
      exports: { ".": { default: "./src/index.ts" } },
      langwatch: { group: "framework" },
    }),
    "packages/fixture-framework/package.json": JSON.stringify({
      name: "@langwatch/fixture-framework",
      exports: "./src/index.ts",
      langwatch: { layout: "features" },
    }),
  },
});

afterAll(() => frameworkWorkspace.cleanup());

function classifyFrameworkPath(workspacePath) {
  resetClassificationCache();

  return classify({
    cwd: frameworkWorkspace.cwd,
    filename: workspacePath,
    physicalFilename: undefined,
  });
}

const FRAMEWORK_CASES = [
  {
    path: "packages/eventing/src/features/claim/services/claimed-job.service.ts",
    expected: {
      role: "framework",
      kind: "framework",
      feature: undefined,
      module: undefined,
      relative: "src/features/claim/services/claimed-job.service.ts",
      sourcePath: "features/claim/services/claimed-job.service.ts",
      layer: "services",
      isServiceModule: true,
      isPrismaSeam: false,
      strictSource: {
        enterprise: false,
        entry: false,
        feature: "eventing",
        name: "claimed-job.service.ts",
        role: "framework",
        sourcePath: "features/claim/services/claimed-job.service.ts",
      },
    },
  },
  {
    path: "packages/eventing/src/index.ts",
    expected: { role: "framework", layer: undefined, strictSource: { entry: true } },
  },
  {
    path: "packages/eventing/src/server/index.ts",
    expected: { role: "framework", strictSource: { entry: true, sourcePath: "server/index.ts" } },
  },
  {
    path: "packages/eventing/src/server/maintenance.ts",
    expected: { role: "framework", strictSource: { entry: false } },
  },
  {
    path: "packages/eventing/src/app/event-sourcing.app.ts",
    expected: { role: "framework", layer: undefined, strictSource: { entry: false } },
  },
  {
    path: "packages/eventing/src/vocabulary/eventing.errors.ts",
    expected: { role: "framework", layer: "vocabulary" },
  },
  {
    path: "packages/eventing/src/telemetry/eventing.metrics.ts",
    expected: { role: "framework", layer: "telemetry" },
  },
  {
    path: "packages/eventing/src/features/process-managers/repositories/prisma/prisma.process-store.repository.ts",
    expected: { role: "framework", layer: "repositories", isPrismaSeam: true },
  },
  {
    path: "packages/eventing/src/features/replay/channels/redis/redis.queue-activity.channel.ts",
    expected: { role: "framework", layer: "channels" },
  },
  {
    path: "packages/eventing/src/features/claim/services/__tests__/claimed-job.service.unit.test.ts",
    expected: { role: "framework", isTest: true, layer: "services", strictSource: undefined },
  },
  {
    path: "packages/eventing/vitest.config.ts",
    expected: { role: "framework", kind: undefined, layer: undefined, strictSource: undefined },
  },
  {
    path: "packages/group-queue/src/groupQueue.ts",
    expected: {
      role: "framework",
      kind: undefined,
      sourcePath: undefined,
      layer: undefined,
      strictSource: undefined,
    },
  },
  {
    path: "packages/fixture-framework/src/index.ts",
    expected: { role: "framework", strictSource: { entry: true, feature: "fixture-framework" } },
  },
  {
    path: "packages/unlisted/src/services/unlisted.service.ts",
    expected: { role: "other", layer: undefined, strictSource: undefined },
  },
];

describe("given a framework package and its own manifest", () => {
  describe("when the manifest opts into the feature layout", () => {
    for (const testCase of FRAMEWORK_CASES) {
      it(`classifies ${testCase.path}`, () => {
        expect(classifyFrameworkPath(testCase.path)).toMatchObject(testCase.expected);
      });
    }
  });
});
