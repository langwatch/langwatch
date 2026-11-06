/**
 * What a self-hosting operator reads about where dataset rows live: the environment example.
 * @see specs/datasets/storage-object-only/self-hosting-and-docs.feature
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = (() => {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(directory, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error("no pnpm-workspace.yaml above this test");
    directory = parent;
  }
  return directory;
})();

/** The `## DATASETS` section of the environment example, up to the next blank-line gap. */
function datasetsSection(text: string): string {
  const start = text.indexOf("## DATASETS");
  if (start === -1) return "";
  const end = text.indexOf("\n\n\n", start);
  return text.slice(start, end === -1 ? undefined : end);
}

describe("given the environment example", () => {
  const example = readFileSync(path.join(REPO_ROOT, ".env.example"), "utf8");

  describe("when it is read", () => {
    /** @scenario "The environment example no longer offers the dead dataset migration opt-out" */
    it("does not offer SKIP_DATASET_S3_MIGRATE, which nothing reads", () => {
      expect(example).not.toContain("SKIP_DATASET_S3_MIGRATE");
    });

    /** @scenario "The environment example no longer offers the dead dataset migration opt-out" */
    it("says datasets need object storage or a persistent local storage path", () => {
      const section = datasetsSection(example);
      expect(section).toContain("LANGWATCH_LOCAL_STORAGE_PATH");
      expect(section).toMatch(/persistent/i);
      expect(section).toMatch(/only copy/i);
    });
  });
});
