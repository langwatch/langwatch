/**
 * @vitest-environment node
 *
 * Tests for dev/scripts/install-check-shims.mjs, which routes direct tsgo /
 * tsc / biome invocations through the check queue so `pnpm exec tsgo -p ...`
 * cannot start a fourth 4 GiB run behind the counter's back.
 *
 * Driven as real processes: the installer runs against a scratch bin directory
 * holding a stand-in launcher, and the resulting shim is executed with the arg
 * shapes that matter. The stand-in reports whether a queue entry exists while
 * it runs, so "took a slot" is an observation of the mechanism rather than an
 * assertion about the shim's text.
 *
 * Corresponds to specs/setup/check-slots.feature.
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const INSTALLER = path.join(REPO_ROOT, "dev/scripts/install-check-shims.mjs");

/** Stands in for pnpm's generated launcher: echoes how it was called. */
const LAUNCHER = `#!/bin/sh
echo "real $*"
`;

/**
 * A launcher that reports whether it is holding a slot. The queue writes its
 * entry before spawning the command and removes it after, so an entry in the
 * directory while this runs means this run took a slot.
 */
const SLOT_REPORTING_LAUNCHER = `#!/bin/sh
if ls "$CHECK_QUEUE_DIR"/*.json >/dev/null 2>&1; then
  echo "queued $*"
else
  echo "direct $*"
fi
`;

let scratch: string;
let binDir: string;
let queueDir: string;

beforeEach(() => {
  scratch = mkdtempSync(path.join(os.tmpdir(), "check-shims-test-"));
  binDir = path.join(scratch, "node_modules", ".bin");
  queueDir = path.join(scratch, "queue");
  mkdirSync(binDir, { recursive: true });
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function writeLauncher(name: string, source = LAUNCHER): void {
  const file = path.join(binDir, name);
  writeFileSync(file, source, "utf8");
  chmodSync(file, 0o755);
}

function install(): { stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [INSTALLER, binDir], {
    encoding: "utf8",
  });
  return { stderr: result.stderr, status: result.status };
}

function runShim(
  name: string,
  args: string[],
): { stdout: string; status: number | null } {
  const result = spawnSync(path.join(binDir, name), args, {
    encoding: "utf8",
    cwd: scratch,
    env: {
      ...process.env,
      CHECK_QUEUE_DIR: queueDir,
      // A slot the run can always take, so taking one shows up as an entry
      // rather than as a wait.
      CHECK_SLOTS: "1",
    },
  });
  return { stdout: result.stdout, status: result.status };
}

const tookASlot = (name: string, args: string[]) =>
  runShim(name, args).stdout.startsWith("queued");

describe("check-queue bin shims", () => {
  describe("given a shimmed launcher that reports its slot", () => {
    beforeEach(() => {
      writeLauncher("tsgo", SLOT_REPORTING_LAUNCHER);
      install();
    });

    /** @scenario "A whole-project run through the binary takes a slot" */
    it("queues a --project run", () => {
      expect(tookASlot("tsgo", ["--noEmit", "-p", "tsconfig.json"])).toBe(true);
      expect(tookASlot("tsgo", ["--noEmit", "--project=tsconfig.json"])).toBe(
        true,
      );
    });

    /** @scenario "A directory argument counts as whole-project" */
    it("queues a run whose path argument is a directory", () => {
      mkdirSync(path.join(scratch, "src"));
      expect(tookASlot("tsgo", ["check", "./src"])).toBe(true);
    });

    /** @scenario "A run with no path argument counts as whole-project" */
    it("queues a run with flags only", () => {
      expect(tookASlot("tsgo", ["--noEmit"])).toBe(true);
      expect(tookASlot("tsgo", [])).toBe(true);
    });

    /** @scenario "A targeted run stays instant" */
    it("runs named files directly", () => {
      writeFileSync(path.join(scratch, "foo.ts"), "export {};", "utf8");
      writeFileSync(path.join(scratch, "bar.ts"), "export {};", "utf8");
      expect(tookASlot("tsgo", ["--noEmit", "foo.ts"])).toBe(false);
      expect(tookASlot("tsgo", ["check", "--write", "foo.ts", "bar.ts"])).toBe(
        false,
      );
    });

    /** @scenario "A watch or language server never takes a slot" */
    it("runs a watch and a language server directly", () => {
      expect(tookASlot("tsgo", ["--watch"])).toBe(false);
      expect(tookASlot("tsgo", ["--lsp"])).toBe(false);
      expect(tookASlot("tsgo", ["-p", "tsconfig.json", "--watch"])).toBe(false);
    });
  });

  describe("given a shimmed launcher", () => {
    beforeEach(() => {
      writeLauncher("tsgo");
      install();
    });

    /** @scenario "The tool's own behavior is untouched" */
    it("passes arguments through unchanged on both routes", () => {
      expect(runShim("tsgo", ["--noEmit", "-p", "tsconfig.json"]).stdout).toBe(
        "real --noEmit -p tsconfig.json\n",
      );
      writeFileSync(path.join(scratch, "foo.ts"), "export {};", "utf8");
      expect(runShim("tsgo", ["--noEmit", "foo.ts"]).stdout).toBe(
        "real --noEmit foo.ts\n",
      );
    });

    /** @scenario "The tool's own behavior is untouched" */
    it("passes the tool's exit code through the queue", () => {
      writeFileSync(
        path.join(binDir, "tsgo.real"),
        "#!/bin/sh\nexit 7\n",
        "utf8",
      );
      chmodSync(path.join(binDir, "tsgo.real"), 0o755);
      expect(runShim("tsgo", ["--noEmit"]).status).toBe(7);
    });

    /** @scenario "Installing the shims is idempotent" */
    it("leaves an already-shimmed entry alone", () => {
      const shimmed = readFileSync(path.join(binDir, "tsgo"), "utf8");
      const second = install();

      expect(second.status).toBe(0);
      expect(second.stderr).toBe("");
      expect(readFileSync(path.join(binDir, "tsgo"), "utf8")).toBe(shimmed);
      // The launcher was not swallowed by a second round of renaming.
      expect(readFileSync(path.join(binDir, "tsgo.real"), "utf8")).toBe(
        LAUNCHER,
      );
      expect(runShim("tsgo", ["--noEmit"]).stdout).toBe("real --noEmit\n");
    });

    /** @scenario "A reinstall re-shims what pnpm regenerated" */
    it("re-shims an entry pnpm has overwritten", () => {
      // What `pnpm install` does: the bin entry is replaced by a fresh
      // launcher, leaving the previous .real behind.
      writeLauncher("tsgo");
      expect(runShim("tsgo", ["--noEmit"]).stdout).toBe("real --noEmit\n");

      install();

      expect(readFileSync(path.join(binDir, "tsgo"), "utf8")).toContain(
        "langwatch-check-queue-shim",
      );
      expect(existsSync(path.join(binDir, "tsgo.real"))).toBe(true);
      expect(runShim("tsgo", ["--noEmit"]).stdout).toBe("real --noEmit\n");
    });
  });

  describe("given nothing to shim", () => {
    /** @scenario "Installing the shims is idempotent" */
    it("says nothing and succeeds", () => {
      const result = install();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(existsSync(path.join(binDir, "tsgo"))).toBe(false);
    });
  });
});
