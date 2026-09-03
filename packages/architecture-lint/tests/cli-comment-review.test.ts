import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(packageRoot, "src/cli.ts");
const tsx = join(packageRoot, "node_modules/.bin/tsx");

function lineComments(lines: number): string {
  return Array.from({ length: lines }, () => "// comment").join("\n");
}

function writeFixture(root: string, file: string, source: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${source}\n`);
}

describe("comment-block review CLI", () => {
  it("reports the review queue and only fails hard comment blocks", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-review-cli-"));
    writeFixture(root, "src/review.ts", lineComments(5));
    writeFixture(root, "src/hard.ts", lineComments(6));

    const result = spawnSync(
      tsx,
      [cli, "--root", root, "--review-comment-blocks", "--all-comment-blocks"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("comment-block review queue");
    expect(result.stdout).toContain("src/review.ts:1");
    expect(result.stderr).toContain("[comment-block-size] src/hard.ts:1");
    expect(result.stderr).not.toContain("feature-catalogue");
  });
});
