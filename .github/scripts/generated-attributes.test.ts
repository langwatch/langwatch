// Every tracked output of a generator carries `linguist-generated` in
// .gitattributes, so reviews collapse it and the impact map counts it as
// Generated. A new generator lists its outputs here. Run with
// `node --test --experimental-strip-types`. Spec: specs/ci/generated-attributes.feature
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");

/** Each generator and the git glob pathspecs of the files it writes. */
const GENERATOR_OUTPUTS: readonly { generator: string; globs: readonly string[] }[] = [
  {
    generator: "package managers (lockfiles)",
    globs: ["**/pnpm-lock.yaml", "**/uv.lock", "**/go.sum", "go.work.sum"],
  },
  {
    generator: "pnpm generate:modules",
    globs: ["apps/*/src/process-modules.generated.ts", "apps/ui/src/browser-modules.generated.ts"],
  },
  { generator: "pnpm sync:references", globs: ["tsconfig.build.json"] },
  {
    generator: "pnpm generate:readmes",
    globs: [
      "modules/README.md",
      "packages/README.md",
      "apps/README.md",
      "enterprise/README.md",
      "enterprise/modules/README.md",
      "enterprise/packages/README.md",
      "modules/*/README.md",
      "modules/*/process/README.md",
      "enterprise/modules/*/README.md",
      "enterprise/modules/*/process/README.md",
    ],
  },
  { generator: "architecture-enforcer docs", globs: ["dev/docs/lint-rules.md"] },
  { generator: "cmd/herrgen", globs: ["packages/handled-error/src/codes.generated.ts"] },
  {
    generator: "langevals generate_evaluators_ts / evaluator generate:evaluators",
    globs: [
      "services/langevals/ts-integration/evaluators.generated.ts",
      "modules/evaluator/contract/src/evaluators.generated.ts",
    ],
  },
  {
    generator: "analytics generate:vega-validator",
    globs: ["modules/analytics/contract/src/visualization/vega-lite-schema-validator.generated.*"],
  },
  {
    generator: "analytics generate:lwql-*-manifest",
    globs: ["modules/analytics/process/src/rules/lwql-*-manifest.generated.*"],
  },
  {
    generator: "analytics generate:query-reference-fixture",
    globs: ["mcp/typescript/src/__tests__/fixtures/query-reference.json"],
  },
  {
    generator: "langy generate:langy-skills / generate:feature-map / generate:setup-skill-bodies",
    globs: [
      "modules/langy/browser/src/model/shared/langy/*.generated.json",
      "modules/langy/process/src/rules/setup-skill-bodies.rules.ts",
    ],
  },
  {
    generator: "module check-feature-names",
    globs: ["packages/module/src/feature-names.generated.ts"],
  },
  {
    generator: "make sync-all-openapi",
    globs: [
      "docs/api-reference/openapiLangWatch.json",
      "docs/api-reference/openapi-evals.json",
      "sdks/typescript/src/internal/generated/**/*.ts",
      "sdks/python/src/langwatch/generated/**",
      "sdks/go/client/internal/openapi/zz_generated.gen.go",
    ],
  },
  {
    generator: "docs llms.txt.cjs / generate-usage-report-dictionary.sh",
    globs: ["docs/llms.txt", "docs/llms-full.txt", "docs/self-hosting/usage-report-dictionary.mdx"],
  },
  {
    generator: "skills/_compiled/generate.sh",
    globs: ["skills/_compiled/native/**", "services/langyagent/internal/assets/skills/**"],
  },
];

const git = (args: readonly string[], input?: string): string =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", input, maxBuffer: 1 << 28 });

const tracked = (glob: string): string[] =>
  git(["ls-files", "-z", "--", `:(glob)${glob}`])
    .split("\0")
    .filter(Boolean);

/** The files among `paths` whose linguist-generated attribute is not true. */
const unmarked = (paths: readonly string[]): string[] => {
  if (paths.length === 0) return [];
  const out = git(["check-attr", "-z", "--stdin", "linguist-generated"], paths.join("\0") + "\0");
  const fields = out.split("\0");
  const missing: string[] = [];
  for (let i = 0; i + 2 < fields.length; i += 3) {
    if (fields[i + 2] !== "true") missing.push(fields[i]!);
  }
  return missing;
};

void describe("given the generators and the files they write", () => {
  for (const { generator, globs } of GENERATOR_OUTPUTS) {
    void describe(`when ${generator} has written its outputs`, () => {
      for (const glob of globs) {
        /** @scenario "A listed output glob that matches no tracked file fails the guard" */
        void it(`still writes a tracked file matching ${glob}`, () => {
          assert.notEqual(
            tracked(glob).length,
            0,
            `${glob} matches no tracked file: drop or fix it`,
          );
        });
        /** @scenario "Every tracked output of a known generator is marked generated" */
        void it(`marks every tracked ${glob} linguist-generated`, () => {
          assert.deepEqual(unmarked(tracked(glob)), [], "add a .gitattributes line for these");
        });
      }
    });
  }

  void describe("when a README carries the readmegen block", () => {
    /** @scenario "A README carrying the readmegen block is marked generated" */
    void it("is marked linguist-generated", () => {
      const out = git(["grep", "--cached", "-lz", "-e", "^<!-- readme:generated:start", "--", "*README.md"]);
      const readmes = out.split("\0").filter(Boolean);
      assert.notEqual(readmes.length, 0);
      assert.deepEqual(unmarked(readmes), [], "add a .gitattributes line for these");
    });
  });

  void describe("when a tracked file is named *.generated.*", () => {
    /** @scenario "A file named with the generated infix is marked generated" */
    void it("is marked linguist-generated", () => {
      assert.deepEqual(unmarked(tracked("**/*.generated.*")), []);
    });
  });
});
