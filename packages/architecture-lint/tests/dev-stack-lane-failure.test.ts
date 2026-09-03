/**
 * A lane that fails takes the stack down, it is not rebooted in a loop.
 *
 * Corresponds to specs/setup/dev-stack-lifecycle.feature. The flags are read
 * from dev-stack.sh itself, so the test runs concurrently the way `pnpm dev`
 * does; a fixed flag list here would keep passing after the script drifted.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const DEV_STACK = path.join(REPO_ROOT, "dev/scripts/dev-stack.sh");

function concurrentlyFlagsOf(script: string): string[] {
  const block = /exec pnpm -s exec concurrently \\\n([\s\S]*?)"\$\{COMMANDS\[@\]\}"/.exec(script);
  if (!block) throw new Error("dev-stack.sh no longer runs concurrently the expected way");
  return block[1]
    .split("\n")
    .map((line) => line.trim().replace(/\\$/, "").trim())
    .filter((line) => line.startsWith("--"))
    .filter((line) => !line.startsWith("--names") && !line.startsWith("--prefix-colors"))
    .flatMap((line) => line.split(/\s+/));
}

describe("given a stack whose lanes are started the way pnpm dev starts them", () => {
  describe("when one lane exits with an error as soon as it starts", () => {
    /** @scenario "A lane that fails takes the stack down instead of rebooting in a loop" */
    it("stops the other lanes and exits with a failure without restarting the lane", () => {
      const flags = concurrentlyFlagsOf(readFileSync(DEV_STACK, "utf8"));
      const started = Date.now();
      const run = spawnSync(
        "pnpm",
        [
          "-s",
          "exec",
          "concurrently",
          ...flags,
          "--names",
          "broken,healthy",
          "printf 'BOOT_%s\\n' FAILED >&2; exit 1",
          "sleep 20",
        ],
        { cwd: REPO_ROOT, encoding: "utf8", timeout: 15_000 },
      );
      const output = `${run.stdout}\n${run.stderr}`;

      expect(run.status).not.toBe(0);
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(output).toContain("BOOT_FAILED");
      expect(output).not.toMatch(/restarted/);
      expect((output.match(/BOOT_FAILED/g) ?? []).length).toBe(1);
    });
  });
});
