/**
 * The capability objects a host receives are class instances whose methods
 * read `this`; a bare `setQuery: route.setQuery` hand-off loses the receiver
 * and throws on first use. Spec: specs/ui/host-capability-binding.feature
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Host adapters now live one per module, under each module's `browser/src`
 * (plain and enterprise), not under an `apps/ui/src/features` this package
 * no longer has.
 */
const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const moduleGroupDirs = ["modules", "enterprise/modules"].map((dir) => path.join(repoRoot, dir));
const UNBOUND_HANDOFF =
  /^\s+[A-Za-z]+:\s*(route|feedback|navigation|session|clipboard)\.[A-Za-z]+,?\s*$/;

function hostFiles(): string[] {
  return moduleGroupDirs.flatMap((groupDir) =>
    readdirSync(groupDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((module_) => {
        const browserSrc = path.join(groupDir, module_.name, "browser/src");
        if (!existsSync(browserSrc)) return [];
        return (readdirSync(browserSrc, { recursive: true }) as string[])
          .filter((relative) => /(?:^|\/)ui\/sections\//.test(relative))
          .filter((relative) => relative.endsWith("-host.tsx") || relative.endsWith("/host.tsx"))
          .map((relative) => path.join(browserSrc, relative));
      }),
  );
}

describe("host adapters and their capability hand-offs", () => {
  describe("when every host adapter is read", () => {
    /** @scenario "No host hands a capability method on unbound" */
    it("passes no route, feedback, navigation, session or clipboard method as a bare property", () => {
      const files = hostFiles();
      // A sanity floor, not a target: catches a broken scan, not a headcount.
      expect(files.length).toBeGreaterThan(0);
      const offenders = files.flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => UNBOUND_HANDOFF.test(line))
          .map(({ index }) => `${path.relative(repoRoot, file)}:${index + 1}`),
      );
      expect(offenders).toEqual([]);
    });
  });
});
