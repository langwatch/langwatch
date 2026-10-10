// Run with `node --test --experimental-strip-types`, like the other guards here.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, it } from "node:test";

type IsGenerated = (path: string) => boolean;
const { classify, generatedMatcher, moduleOf } = createRequire(import.meta.url)(
  "./pr-impact-map-categories.cjs",
) as {
  classify: (path: string, options?: { isGenerated?: IsGenerated }) => string;
  generatedMatcher: (gitattributes: string) => IsGenerated;
  moduleOf: (path: string) => string | null;
};

const ROOT = resolve(import.meta.dirname, "../..");
const isGenerated = generatedMatcher(readFileSync(resolve(ROOT, ".gitattributes"), "utf8"));

void describe("pr-impact-map categories", () => {
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
    ["modules/prompt/README.md", "Generated"],
    ["modules/prompt/process/README.md", "Generated"],
    ["modules/prompt/browser/README.md", "Generated"],
    ["apps/api/src/process-modules.generated.ts", "Generated"],
    ["sdks/typescript/src/internal/generated/openapi/api-client.ts", "Generated"],
    ["dev/docs/lint-rules.md", "Generated"],
    ["tsconfig.build.json", "Generated"],
    ["sdks/go/client/go.sum", "Deps"],
    ["enterprise/packages/licence/src/index.ts", "Framework"],
    ["plugins/langwatch/hooks/a.ts", "SDKs"],
    ["cmd/readmegen/main.go", "Tools"],
    ["cmd/service/main.go", "Go services"],
    [".claude/rules/testing.md", "Docs"],
    [".claude/settings.json", "Tools"],
    ["apps/worker/src/config.ts", "Apps"],
    ["infra/docker/Dockerfile.langevals", "Deploy"],
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
    void it(`attributes ${path} to ${category}`, () => {
      assert.equal(classify(path, { isGenerated }), category);
    });
  }

  void it("never reports Generated without the .gitattributes matcher", () => {
    assert.equal(classify("modules/prompt/README.md"), "Docs");
  });

  void it("lets a later -linguist-generated line unset an earlier match", () => {
    const matcher = generatedMatcher(
      "docs/** linguist-generated=true\ndocs/a.md -linguist-generated\n",
    );
    assert.equal(matcher("docs/b.md"), true);
    assert.equal(matcher("docs/a.md"), false);
  });

  void it("agrees with git check-attr on every tracked file", () => {
    const git = (args: string[], input?: string): string =>
      execFileSync("git", args, { cwd: ROOT, encoding: "utf8", input, maxBuffer: 1 << 28 });
    const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
    const fields = git(
      ["check-attr", "-z", "--stdin", "linguist-generated"],
      files.join("\0") + "\0",
    ).split("\0");
    const disagreements: string[] = [];
    for (let i = 0; i + 2 < fields.length; i += 3) {
      if ((fields[i + 2] === "true") !== isGenerated(fields[i]!)) disagreements.push(fields[i]!);
    }
    assert.deepEqual(disagreements.slice(0, 20), []);
  });

  void it("names the module of a module path only", () => {
    assert.equal(moduleOf("enterprise/modules/billing/process/src/a.ts"), "billing");
    assert.equal(moduleOf("modules/trace/specs/a.feature"), "trace");
    assert.equal(moduleOf("packages/api/src/a.ts"), null);
  });
});
