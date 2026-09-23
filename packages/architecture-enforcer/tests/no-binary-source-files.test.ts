import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * No tracked source file may contain a raw NUL byte — git renders such a
 * blob as "Binary file not shown", invisible in diffs. Checked by reading
 * bytes (not `grep -P '\x00'`); fix by replacing it with a `\u0000` escape.
 */

// The repository root. The platform copy of this guard resolved three levels
// up from `platform/app/src/__tests__/`, which is `<repo>/platform` — so it
// only ever scanned that one subtree. From here the same walk reaches the
// real root, which is what the guard always claimed to check.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const trackedSourceFiles = (): string[] =>
  execFileSync("git", ["ls-files", "-z", "--", "*.ts", "*.tsx", "*.js", "*.jsx", "*.py", "*.go"], {
    cwd: REPO_ROOT,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);

describe("tracked source files", () => {
  it("contain no NUL bytes, so git and GitHub render them as text", () => {
    const offenders = trackedSourceFiles().filter((relativePath) => {
      let contents: Buffer;
      try {
        contents = readFileSync(join(REPO_ROOT, relativePath));
      } catch {
        // A path in the index but not on disk (a partial checkout, a file
        // deleted in the working tree) is not this test's concern.
        return false;
      }
      return contents.includes(0);
    });

    expect(offenders).toEqual([]);
    // Reading ~19k tracked source files takes well over vitest's 5s default.
  }, 120_000);
});
