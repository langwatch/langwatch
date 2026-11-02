import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { withTemporaryDirectory } from "../temporary-directory.ts";

describe("prerender directories", () => {
  /** @scenario "Prerender in a directory owned by one build" */
  it("gives concurrent builds separate directories and removes only their own", async () => {
    const parent = mkdtempSync(path.join(os.tmpdir(), "docs-build-parent-"));
    const neighbour = path.join(parent, "another-build-output");
    writeFileSync(neighbour, "kept");
    try {
      const seen: string[] = [];
      const failing = withTemporaryDirectory({
        parent,
        prefix: "docs-prerender-",
        run: async (directory) => {
          seen.push(directory);
          throw new Error("render failed");
        },
      });
      const passing = withTemporaryDirectory({
        parent,
        prefix: "docs-prerender-",
        run: async (directory) => {
          seen.push(directory);
          writeFileSync(path.join(directory, "prerender.js"), "");
          return directory;
        },
      });
      await expect(failing).rejects.toThrow("render failed");
      await passing;
      expect(new Set(seen).size).toBe(2);
      for (const directory of seen) expect(existsSync(directory)).toBe(false);
      expect(existsSync(neighbour)).toBe(true);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
