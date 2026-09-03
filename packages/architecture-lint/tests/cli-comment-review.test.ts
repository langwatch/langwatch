import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
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

  it("prints the 4-5 line warn tier on stderr for a changed file on a plain run (R1)", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-review-cli-plain-"));
    execFileSync("git", ["-C", root, "init", "--quiet", "--initial-branch=main"], {
      stdio: "ignore",
    });
    execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"], {
      stdio: "ignore",
    });
    execFileSync("git", ["-C", root, "config", "user.name", "Architecture Lint Test"], {
      stdio: "ignore",
    });
    execFileSync("git", ["-C", root, "config", "commit.gpgsign", "false"], { stdio: "ignore" });
    writeFixture(root, "src/base.ts", "export const base = 1;");
    execFileSync("git", ["-C", root, "add", "."], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "commit", "--quiet", "-m", "base"], { stdio: "ignore" });
    writeFixture(root, "src/review.ts", lineComments(4));

    const result = spawnSync(tsx, [cli, "--root", root, "--no-declarations"], {
      encoding: "utf8",
    });

    expect(result.stderr).toContain("architecture-lint: comment-block review");
    expect(result.stderr).toContain("src/review.ts:1");
  });
});
