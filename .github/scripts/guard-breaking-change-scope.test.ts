import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import {
  bumpedComponents,
  carriesBreakingChange,
  releaseComponents,
} from "./guard-breaking-change-scope.ts";

const repoRoot = resolve(import.meta.dirname, "../..");

const liveComponents = () =>
  releaseComponents(
    JSON.parse(
      readFileSync(
        resolve(repoRoot, ".github/release-please-config.json"),
        "utf8",
      ),
    ),
  );

const names = (files: string[]): string[] =>
  bumpedComponents(files, liveComponents())
    .map((component) => component.name)
    .sort();

describe("breaking-change scope guard", () => {
  describe("when reading the markers release-please reads", () => {
    it("finds the `!` marker in a header, scoped or not", () => {
      assert.equal(carriesBreakingChange(["feat!: drop the v1 endpoint"]), true);
      assert.equal(
        carriesBreakingChange(["feat(evaluators)!: remove the legacy ones"]),
        true,
      );
    });

    it("finds a header that arrives as a squash-body bullet", () => {
      assert.equal(
        carriesBreakingChange([
          "chore: merge branch\n\n* feat(evaluators)!: remove the legacy ones\n",
        ]),
        true,
      );
    });

    it("finds both spellings of the footer", () => {
      assert.equal(
        carriesBreakingChange(["feat: x\n\nBREAKING CHANGE: the v1 endpoint"]),
        true,
      );
      assert.equal(
        carriesBreakingChange(["feat: x\n\nBREAKING-CHANGE: the v1 endpoint"]),
        true,
      );
    });

    it("ignores prose that only talks about breaking changes", () => {
      assert.equal(
        carriesBreakingChange([
          "fix(api): keep the v1 endpoint alive\n\nThis is not a BREAKING CHANGE, the shim stays.",
        ]),
        false,
      );
      assert.equal(carriesBreakingChange(["feat(api): add a v2 endpoint"]), false);
    });
  });

  describe("when mapping changed files onto release components", () => {
    it("charges a file to its own package and not to a sibling", () => {
      assert.deepEqual(names(["sdks/typescript/src/index.ts"]), [
        "typescript-sdk",
      ]);
    });

    it("charges a nested package over the parent that contains it", () => {
      const components = releaseComponents({
        packages: {
          "sdks": { component: "sdks" },
          "sdks/typescript": { component: "typescript-sdk" },
        },
      });
      assert.deepEqual(
        bumpedComponents(["sdks/typescript/src/index.ts"], components).map(
          (component) => component.name,
        ),
        ["typescript-sdk"],
      );
    });

    it("charges a top-level file to the root package alone", () => {
      assert.deepEqual(names(["SECURITY.md"]), ["langwatch"]);
    });

    it("spares the root package when every file sits in an excluded path", () => {
      assert.deepEqual(names(["mcp/typescript/src/server.ts"]), ["mcp-server"]);
    });

    it("charges the root package when one file escapes the excluded paths", () => {
      // The shape of #6641: fifteen files under mcp/typescript, plus SECURITY.md.
      assert.deepEqual(
        names(["mcp/typescript/src/server.ts", "SECURITY.md"]),
        ["langwatch", "mcp-server"],
      );
    });

    it("reproduces the three components #6600 bumped at once", () => {
      assert.deepEqual(
        names([
          "sdks/typescript/src/cli/commands/evaluators/catalog.ts",
          "services/langevals/pyproject.toml",
          "platform/app/src/server/evaluations/evaluators.generated.ts",
        ]),
        ["langevals", "langwatch", "typescript-sdk"],
      );
    });

    it("spares a package whose every touched file is excluded", () => {
      const components = releaseComponents({
        packages: {
          "sdks/typescript": {
            component: "typescript-sdk",
            "exclude-paths": ["sdks/typescript/docs"],
          },
        },
      });
      assert.deepEqual(
        bumpedComponents(["sdks/typescript/docs/readme.md"], components),
        [],
      );
      assert.deepEqual(
        bumpedComponents(
          ["sdks/typescript/docs/readme.md", "sdks/typescript/src/index.ts"],
          components,
        ).map((component) => component.name),
        ["typescript-sdk"],
      );
    });
  });

  describe("when reading the release-please config", () => {
    it("keeps every configured package, named by its component", () => {
      const configured = liveComponents();
      const byPath = new Map(
        configured.map((component) => [component.path, component]),
      );
      assert.equal(byPath.get("sdks/typescript")?.name, "typescript-sdk");
      assert.equal(byPath.get(".")?.name, "langwatch");
      assert.ok(
        byPath.get(".")?.excludePaths.includes("sdks/typescript"),
        "the root package must keep excluding the typescript SDK",
      );
    });

    it("trims surrounding slashes the way release-please normalizes them", () => {
      const [component] = releaseComponents({
        packages: { ".": { component: "root", "exclude-paths": ["/skills/"] } },
      });
      assert.deepEqual(component?.excludePaths, ["skills"]);
    });
  });
});
