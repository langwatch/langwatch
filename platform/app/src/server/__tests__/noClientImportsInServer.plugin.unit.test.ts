/**
 * @vitest-environment node
 *
 * @see specs/setup/memory-footprint.feature — "A client import into server code
 * is refused as it is written"
 *
 * Runs the real Biome plugin over the real fixture file and asserts exactly
 * which imports it flags. It shells out to Biome on purpose: asserting that the
 * `.grit` source contains some substring would pass just as happily on a rule
 * that no longer compiles, and a plugin that fails to compile reports nothing
 * while `pnpm lint` still exits 0 for every other rule.
 *
 * The fixture lives under `biome-plugins/__tests__/`, which is outside Biome's
 * scan scope — pointed at directly it reports "paths ignored" and counts zero.
 * It is also scoped by `$filename`, so a copy landing anywhere but a backend
 * tree flags nothing. Both together mean the fixture has to be copied INTO a
 * backend tree to be measured, which is what this test does.
 *
 * IT IS COPIED INTO A DOT-DIRECTORY, and that detail is not cosmetic. The first
 * version wrote the copy to `src/server/` directly, which made this test corrupt
 * its own companion: `frontend-boundary.unit.test.ts` walks `src/server` for
 * every file, and running the two in parallel had the walker list the scratch
 * file and then fail with ENOENT when this test deleted it mid-read. A
 * dot-directory is invisible to that walk — it skips entries beginning with `.`
 * — while Biome still lints the path when handed it explicitly. Any replacement
 * for this scratch path has to satisfy both halves.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "../../..");

const FIXTURE = path.join(
  APP_ROOT,
  "biome-plugins/__tests__/no-client-imports-in-server.fixtures.ts",
);
/**
 * Dot-prefixed so the transitive walker skips it, and unique per process so two
 * runs in parallel cannot delete each other's copy.
 */
const SCRATCH_DIR = path.join(APP_ROOT, "src/server/.lint-fixtures");
const SCRATCH = path.join(SCRATCH_DIR, `fixture-${process.pid}.ts`);

const cleanUp = () => {
  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
};
afterAll(cleanUp);

/** The module specifiers the plugin flagged, in file order. */
const flaggedSpecifiers = (): string[] => {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  fs.copyFileSync(FIXTURE, SCRATCH);
  let raw: string;
  try {
    raw = execFileSync(
      path.join(APP_ROOT, "node_modules/.bin/biome"),
      [
        "lint",
        "--only=plugin",
        "--reporter=rdjson",
        "--max-diagnostics=none",
        // `--vcs-enabled=false` is REQUIRED, not tidiness. biome.jsonc sets
        // `vcs.useIgnoreFile: true`, and `.gitignore` lists this scratch
        // directory so an interrupted run cannot leave a deliberately-violating
        // file staged. Without this flag Biome honours that entry, skips the
        // file, and returns zero diagnostics — the test then fails claiming the
        // rule is broken when the rule is fine.
        "--vcs-enabled=false",
        SCRATCH,
      ],
      { cwd: APP_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch (error) {
    // Biome exits non-zero precisely because it found the violations we want.
    raw = (error as { stdout?: string }).stdout ?? "";
  } finally {
    cleanUp();
  }

  if (!raw.trim()) {
    throw new Error(
      "Biome produced no rdjson output. The plugin most likely failed to compile — run `pnpm lint:plugins` to see the error.",
    );
  }

  const lines = fs.readFileSync(FIXTURE, "utf8").split("\n");
  const parsed = JSON.parse(raw) as {
    diagnostics: { location: { range: { start: { line: number } } } }[];
  };

  return parsed.diagnostics.map((d) => {
    const text = lines[d.location.range.start.line - 1] ?? "";
    return /["']([^"']+)["']/.exec(text)?.[1] ?? text.trim();
  });
};

describe("given the no-client-imports-in-server lint rule and its fixtures", () => {
  describe("when Biome lints the fixture inside a backend tree", () => {
    /** @scenario "A client import into server code is refused as it is written" */
    it("flags every banned value import and nothing else", () => {
      expect(flaggedSpecifiers().sort()).toEqual(
        [
          "@chakra-ui/react",
          "react",
          "react",
          "~/components/analytics/CustomGraph",
          "~/components/datasets/utils/reservedColumns",
          "~/features/langy/components/capabilities/capabilityRegistry",
        ].sort(),
      );
    });

    it("allows the type-only, lookalike-package and lifecycle-hook imports", () => {
      const flagged = flaggedSpecifiers();

      // `reactflow` and `@react-email/*` both begin with the banned word, and
      // `ee/billing/nurturing/hooks/` is a server lifecycle hook, not a React
      // one. Each was a real false positive during development.
      expect(flagged).not.toContain("reactflow");
      expect(flagged).not.toContain("@react-email/render");
      expect(flagged).not.toContain("@opentelemetry/api");
      expect(flagged).not.toContain("~/hooks/useFilterParams");
      expect(flagged).not.toContain("~/utils/componentsHelper");
      expect(flagged).not.toContain(
        "~/../ee/billing/nurturing/hooks/signupIdentification",
      );
    });
  });
});
