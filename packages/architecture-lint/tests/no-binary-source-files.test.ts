import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * No tracked source file may contain a NUL byte.
 *
 * Git decides a blob is binary by looking for a NUL in its first 8000 bytes,
 * and GitHub then renders it as "Binary file not shown". A TypeScript file
 * that trips that is not merely ugly — it is UNREVIEWABLE, and stays that way
 * for every future diff touching it.
 *
 * Eight files in this repo had one, all the same mistake: a NUL written as a
 * raw byte where a backslash-u-0000 escape was meant. The two spellings
 * produce an identical string at runtime, and the raw one renders as an
 * ordinary space in most editors and in `git diff`'s own output — so nothing
 * about the source looks wrong, and review never sees the file to notice.
 *
 * Checked by reading bytes rather than by grepping: `grep -P '\x00'` does not
 * reliably match, which is how a sweep for this once came back clean while
 * the file it was meant to catch was still binary.
 *
 * If this fails: replace the raw NUL with the escape. The runtime string is
 * unchanged; only the file becomes text again.
 */

// The repository root. The platform copy of this guard resolved three levels
// up from `platform/app/src/__tests__/`, which is `<repo>/platform` — so it
// only ever scanned that one subtree. From here the same walk reaches the
// real root, which is what the guard always claimed to check.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const trackedSourceFiles = (): string[] =>
  execFileSync(
    "git",
    ["ls-files", "-z", "--", "*.ts", "*.tsx", "*.js", "*.jsx", "*.py", "*.go"],
    { cwd: REPO_ROOT, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  )
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
  });
});
