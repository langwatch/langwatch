import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Verifies that our declared peer dependency ranges accept the latest
 * versions of common AI frameworks that users install alongside langwatch.
 *
 * This catches the exact bug where langwatch declared @ai-sdk/openai@">=2.0.0 <3.0.0"
 * but @mastra/core pulled in @ai-sdk/openai@^3.x, causing npm ERESOLVE failures.
 *
 * The test reads our local package.json (not the published version) and checks
 * that each peer dep range satisfies the latest stable version on npm.
 */

const sdkPackageJson = JSON.parse(
  readFileSync(join(__dirname, "../../package.json"), "utf-8")
);
const peerDeps: Record<string, string> = sdkPackageJson.peerDependencies;

function getLatestVersion(pkg: string): string {
  return execSync(`npm view ${pkg} version`, {
    encoding: "utf-8",
    timeout: 30_000,
  }).trim();
}

function semverSatisfies(version: string, range: string): boolean {
  // Use npm's own semver to check — avoids adding semver as a dependency
  const result = execSync(
    `node -e "console.log(require('semver').satisfies('${version}', '${range}'))"`,
    { encoding: "utf-8", timeout: 10_000 }
  ).trim();
  return result === "true";
}

// Framework combos that users commonly install alongside langwatch.
// Each entry maps a framework ecosystem to the peer deps it pulls in.
const frameworkCombos: Record<string, string[]> = {
  "Mastra (@mastra/core + @ai-sdk/openai)": ["@ai-sdk/openai"],
  "Vercel AI (ai + @ai-sdk/openai)": ["@ai-sdk/openai"],
  "LangChain ecosystem": [
    "@langchain/core",
    "@langchain/langgraph",
    "@langchain/openai",
    "langchain",
  ],
};

describe("peer dependency compatibility", () => {
  for (const [framework, packages] of Object.entries(frameworkCombos)) {
    describe(`when installed with ${framework}`, () => {
      for (const pkg of packages) {
        it(`accepts latest ${pkg}`, () => {
          const range = peerDeps[pkg];
          if (!range) {
            throw new Error(`${pkg} is not in peerDependencies`);
          }

          const latestVersion = getLatestVersion(pkg);
          const satisfies = semverSatisfies(latestVersion, range);

          expect(
            satisfies,
            `${pkg}@${latestVersion} does not satisfy peer dep range "${range}". ` +
              `Users installing ${pkg}@latest alongside langwatch will get ERESOLVE errors. ` +
              `Update the range in package.json peerDependencies.`
          ).toBe(true);
        });
      }
    });
  }
});
