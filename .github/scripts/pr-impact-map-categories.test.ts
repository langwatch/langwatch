import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const { classify, moduleOf } = createRequire(import.meta.url)("./pr-impact-map-categories.cjs") as {
  classify: (path: string) => string;
  moduleOf: (path: string) => string | null;
};

describe("pr-impact-map categories", () => {
  const cases: [string, string][] = [
    ["packages/prisma-client/prisma/migrations/0001_init/migration.sql", "Migrations"],
    ["packages/clickhouse-migrations/migrations/00001_create_database.sql", "Migrations"],
    ["modules/authz/process/src/migrations/001-x.ts", "Migrations"],
    ["specs/ci/pr-impact-map.feature", "Specs"],
    ["modules/trace/specs/export-progress.feature", "Specs"],
    ["packages/eventing/specs/a.feature", "Specs"],
    ["modules/analytics/process/src/__tests__/a.unit.test.ts", "Tests"],
    ["modules/analytics/process/tests/a.unit.test.ts", "Tests"],
    [".github/workflows/ci.yml", "CI/CD"],
    ["charts/langwatch/values.yaml", "Deploy"],
    ["apps/api/Dockerfile", "Deploy"],
    ["modules/trace/adrs/001.md", "Docs"],
    ["dev/docs/ARCHITECTURE.md", "Docs"],
    ["pnpm-lock.yaml", "Deps"],
    ["modules/trace/contract/src/trace.api.ts", "Modules · contract"],
    ["enterprise/modules/billing/process/src/app/billing.app.ts", "Modules · process"],
    ["modules/prompt/browser/src/ui/a.tsx", "Modules · browser"],
    ["modules/prompt/client/src/index.ts", "Modules · client"],
    ["modules/prompt/README.md", "Docs"],
    ["modules/catalogue.json", "Framework"],
    ["packages/handled-error/src/index.ts", "Framework"],
    ["sdks/python/src/langwatch/client.py", "SDKs"],
    ["mcp/typescript/src/a.ts", "SDKs"],
    ["apps/ui/src/main.ts", "Apps"],
    ["tools/thuishaven/main.go", "Tools"],
    ["services/langevals/a.py", "Python"],
    ["services/aigateway/a.go", "Go services"],
    ["package.json", "Other"],
  ];

  for (const [path, category] of cases) {
    it(`attributes ${path} to ${category}`, () => {
      expect(classify(path)).toBe(category);
    });
  }

  it("names the module of a module path only", () => {
    expect(moduleOf("enterprise/modules/billing/process/src/a.ts")).toBe("billing");
    expect(moduleOf("modules/trace/specs/a.feature")).toBe("trace");
    expect(moduleOf("packages/api/src/a.ts")).toBeNull();
  });
});
