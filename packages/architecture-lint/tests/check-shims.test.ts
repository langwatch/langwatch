/**
 * @vitest-environment node
 *
 * Tests for dev/scripts/install-check-shims.mjs, which routes direct tsgo /
 * tsc invocations through the check queue so `pnpm exec tsgo -p ...`
 * cannot start a fourth 4 GiB run behind the counter's back.
 *
 * Driven as real processes: the installer runs against a scratch bin directory
 * holding a stand-in launcher, and the resulting bin entry is executed with the
 * arg shapes that matter. The stand-in reports whether a queue entry exists
 * while it runs, so "counts against the limit" is an observation of the
 * mechanism rather than an assertion about the shim's text.
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
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const REPO_ROOT = path.resolve(HERE, "../../..");
const INSTALLER = path.join(REPO_ROOT, "dev/scripts/install-check-shims.mjs");

/** Stands in for pnpm's generated launcher: echoes how it was called. */
const LAUNCHER = `#!/bin/sh
echo "real $*"
`;

/**
 * A launcher that reports whether it is holding a slot. The queue writes its
 * entry before spawning the command and removes it after, so an entry in the
 * directory while this runs means this run counted against the limit.
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
  // A test that made the bin directory unwritable has to hand it back, or the
  // cleanup fails and takes the scratch tree with it.
  chmodSync(binDir, 0o755);
  rmSync(scratch, { recursive: true, force: true });
});

function writeLauncher(name: string, source = LAUNCHER): void {
  const file = path.join(binDir, name);
  writeFileSync(file, source, "utf8");
  chmodSync(file, 0o755);
}

function install(env: Record<string, string> = {}): {
  stderr: string;
  status: number | null;
} {
  const result = spawnSync(process.execPath, [INSTALLER, binDir], {
    encoding: "utf8",
    env: {
      ...process.env,
      // The installer stands down on CI and in production, and this suite runs
      // on both a laptop and a CI runner. Every test but the two about that
      // guard is asking for the developer-machine case.
      CI: "",
      NODE_ENV: "",
      ...env,
    },
  });
  return { stderr: result.stderr, status: result.status };
}

function runCheck({ name, args }: { name: string; args: string[] }): {
  stdout: string;
  status: number | null;
} {
  const result = spawnSync(path.join(binDir, name), args, {
    encoding: "utf8",
    cwd: scratch,
    env: {
      ...process.env,
      CHECK_QUEUE_DIR: queueDir,
      // A slot the run can always take, so counting shows up as an entry
      // rather than as a wait.
      CHECK_SLOTS: "1",
      // Pin the JS queue: on a machine with haven installed the wrapper
      // would otherwise delegate this run to `haven slot run`, and the
      // entry-file assertions below read the JS queue's ledger.
      CHECK_QUEUE_IMPL: "js",
    },
  });
  return { stdout: result.stdout, status: result.status };
}

const counted = ({ name, args }: { name: string; args: string[] }) =>
  runCheck({ name, args }).stdout.startsWith("queued");

describe("check-queue bin shims", () => {
  describe("given a tool whose runs report whether they counted", () => {
    beforeEach(() => {
      writeLauncher("tsgo", SLOT_REPORTING_LAUNCHER);
      install();
    });

    describe("when the run walks the whole project", () => {
      /** @scenario "A whole-project run counts however it was started" */
      it("counts a --project run", () => {
        expect(counted({ name: "tsgo", args: ["--noEmit", "-p", "tsconfig.json"] })).toBe(true);
        expect(
          counted({
            name: "tsgo",
            args: ["--noEmit", "--project=tsconfig.json"],
          }),
        ).toBe(true);
      });

      /** @scenario "A run over a directory counts" */
      it("counts a run whose target is a directory", () => {
        mkdirSync(path.join(scratch, "src"));
        expect(counted({ name: "tsgo", args: ["check", "./src"] })).toBe(true);
      });

      /** @scenario "A run that names no target counts" */
      it("counts a run with flags only", () => {
        expect(counted({ name: "tsgo", args: ["--noEmit"] })).toBe(true);
        expect(counted({ name: "tsgo", args: [] })).toBe(true);
      });

      /** @scenario "A subcommand or a flag's value is not a target" */
      it("counts a run whose only operands are a subcommand or a flag value", () => {
        // A bare subcommand checks everything under the cwd; reading
        // `check` as the file to check would let it run uncounted.
        expect(counted({ name: "tsgo", args: ["check", "--write"] })).toBe(true);
        expect(counted({ name: "tsgo", args: ["--pretty", "false"] })).toBe(true);
        expect(counted({ name: "tsgo", args: ["--max-diagnostics", "1000"] })).toBe(true);
      });
    });

    describe("when the run is targeted or long-lived", () => {
      /** @scenario "A run that names files starts immediately" */
      it("does not count a run that names files", () => {
        writeFileSync(path.join(scratch, "foo.ts"), "export {};", "utf8");
        writeFileSync(path.join(scratch, "bar.ts"), "export {};", "utf8");
        expect(counted({ name: "tsgo", args: ["--noEmit", "foo.ts"] })).toBe(false);
        expect(
          counted({
            name: "tsgo",
            args: ["check", "--write", "foo.ts", "bar.ts"],
          }),
        ).toBe(false);
      });

      /** @scenario "A watch or a language server starts immediately" */
      it("does not count a watch or a language server", () => {
        expect(counted({ name: "tsgo", args: ["--watch"] })).toBe(false);
        expect(counted({ name: "tsgo", args: ["--lsp"] })).toBe(false);
        expect(counted({ name: "tsgo", args: ["-p", "tsconfig.json", "--watch"] })).toBe(false);
      });
    });
  });

  describe("given a tool that echoes how it was called", () => {
    beforeEach(() => {
      writeLauncher("tsgo");
      install();
    });

    describe("when it runs on either route", () => {
      /** @scenario "The tool behaves the same either way" */
      it("passes arguments through unchanged", () => {
        expect(runCheck({ name: "tsgo", args: ["--noEmit", "-p", "tsconfig.json"] }).stdout).toBe(
          "real --noEmit -p tsconfig.json\n",
        );
        writeFileSync(path.join(scratch, "foo.ts"), "export {};", "utf8");
        expect(runCheck({ name: "tsgo", args: ["--noEmit", "foo.ts"] }).stdout).toBe(
          "real --noEmit foo.ts\n",
        );
      });

      /** @scenario "The tool behaves the same either way" */
      it("passes the tool's exit code back through the queue", () => {
        writeFileSync(path.join(binDir, "tsgo.real"), "#!/bin/sh\nexit 7\n", "utf8");
        chmodSync(path.join(binDir, "tsgo.real"), 0o755);
        expect(runCheck({ name: "tsgo", args: ["--noEmit"] }).status).toBe(7);
      });
    });

    describe("when the install runs again", () => {
      /** @scenario "Reinstalling leaves the tools working" */
      it("leaves an entry it already owns alone", () => {
        const shimmed = readFileSync(path.join(binDir, "tsgo"), "utf8");
        const second = install();

        expect(second.status).toBe(0);
        expect(second.stderr).toBe("");
        expect(readFileSync(path.join(binDir, "tsgo"), "utf8")).toBe(shimmed);
        // The launcher was not swallowed by a second round of renaming.
        expect(readFileSync(path.join(binDir, "tsgo.real"), "utf8")).toBe(LAUNCHER);
        expect(runCheck({ name: "tsgo", args: ["--noEmit"] }).stdout).toBe("real --noEmit\n");
      });

      /** @scenario "A fresh install restores the counting pnpm overwrote" */
      it("restores counting on an entry pnpm overwrote", () => {
        // What `pnpm install` does: the bin entry is replaced by a fresh
        // launcher, leaving the previous .real behind.
        writeLauncher("tsgo");
        expect(runCheck({ name: "tsgo", args: ["--noEmit"] }).stdout).toBe("real --noEmit\n");

        install();

        expect(readFileSync(path.join(binDir, "tsgo"), "utf8")).toContain(
          "langwatch-check-queue-shim",
        );
        expect(existsSync(path.join(binDir, "tsgo.real"))).toBe(true);
        expect(runCheck({ name: "tsgo", args: ["--noEmit"] }).stdout).toBe("real --noEmit\n");
      });

      /** @scenario "An earlier version of the routing is brought up to date" */
      it("replaces routing an earlier installer left behind", () => {
        // Our marker, different text: what an older version of the installer
        // would have written.
        const stale = readFileSync(path.join(binDir, "tsgo"), "utf8").replace(
          "named_a_target=0",
          "named_a_target=0 # an older way of deciding",
        );
        writeFileSync(path.join(binDir, "tsgo"), stale, "utf8");
        chmodSync(path.join(binDir, "tsgo"), 0o755);

        install();

        const updated = readFileSync(path.join(binDir, "tsgo"), "utf8");
        expect(updated).not.toBe(stale);
        expect(updated).toContain("langwatch-check-queue-shim");
        // The launcher must not end up buried under the replacement: the old
        // shim was standing in for it, not holding it.
        expect(readFileSync(path.join(binDir, "tsgo.real"), "utf8")).toBe(LAUNCHER);
        expect(runCheck({ name: "tsgo", args: ["--noEmit"] }).stdout).toBe("real --noEmit\n");
      });
    });
  });

  describe("given an install that cannot finish", () => {
    /** @scenario "An install that cannot write leaves the tool working" */
    // Root ignores directory mode bits, so there would be no failed install to
    // observe and the test would pass without testing anything. CI runs as a
    // normal user; this is for a container that does not.
    it.skipIf(process.getuid?.() === 0)(
      "leaves the tool runnable when the bin directory is read-only",
      () => {
        writeLauncher("tsgo");
        chmodSync(binDir, 0o555);

        const result = install();

        // It reports the failure and still exits 0: an install must not fail
        // over this.
        expect(result.status).toBe(0);
        expect(result.stderr).toContain("could not shim tsgo");
        // The bin entry is the thing that must survive.
        expect(runCheck({ name: "tsgo", args: ["--noEmit"] }).stdout).toBe("real --noEmit\n");
        expect(existsSync(path.join(binDir, "tsgo.shim-staging"))).toBe(false);
      },
    );
  });

  describe("given an environment the shims are not for", () => {
    beforeEach(() => {
      writeLauncher("tsgo");
    });

    describe("when the install runs there", () => {
      /** @scenario "CI installs are left alone" */
      it("stands down on CI, and only for a CI that means it", () => {
        const skipped = install({ CI: "true" });

        expect(skipped.status).toBe(0);
        expect(skipped.stderr).toContain("CI");
        expect(readFileSync(path.join(binDir, "tsgo"), "utf8")).toBe(LAUNCHER);
        expect(existsSync(path.join(binDir, "tsgo.real"))).toBe(false);

        // The value a shell leaves behind when it means the opposite.
        install({ CI: "false" });
        expect(readFileSync(path.join(binDir, "tsgo"), "utf8")).toContain(
          "langwatch-check-queue-shim",
        );
      });

      /** @scenario "Production installs are left alone" */
      it("stands down on a production install", () => {
        const result = install({ NODE_ENV: "production" });

        expect(result.status).toBe(0);
        expect(result.stderr).toContain("production");
        expect(readFileSync(path.join(binDir, "tsgo"), "utf8")).toBe(LAUNCHER);
        expect(existsSync(path.join(binDir, "tsgo.real"))).toBe(false);
      });
    });
  });

  describe("given nothing to shim", () => {
    /** @scenario "Reinstalling leaves the tools working" */
    it("says nothing and succeeds", () => {
      const result = install();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(existsSync(path.join(binDir, "tsgo"))).toBe(false);
    });
  });
});
