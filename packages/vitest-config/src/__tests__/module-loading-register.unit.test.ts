import { execFileSync, fork } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const HOOKS_DIR = fileURLToPath(new URL("../module-loading-cache", import.meta.url));

/** A workspace of its own with a copy of the hooks, so the real cache is never touched. */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "module-loading-register-"));
  const pkg = join(root, "node_modules", "left-pad");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  writeFileSync(join(pkg, "one.js"), "module.exports = 1;\n");
  writeFileSync(join(pkg, "two.js"), "module.exports = 2;\n");
  const pointPackageAt = (main: string) =>
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "left-pad", main }));
  pointPackageAt("one.js");
  cpSync(HOOKS_DIR, join(root, "hooks"), { recursive: true });
  const entry = join(root, "main.mjs");
  writeFileSync(entry, 'import pad from "left-pad";\nconsole.log(pad);\n');
  const exitOnSigterm = join(root, "sigterm.mjs");
  writeFileSync(
    exitOnSigterm,
    'import "left-pad";\nprocess.kill(process.pid, "SIGTERM");\nsetTimeout(() => {}, 5000);\n',
  );
  const register = pathToFileURL(join(root, "hooks", "register.ts")).href;
  return {
    root,
    entry,
    exitOnSigterm,
    register,
    pointPackageAt,
    cacheFiles: () => {
      const dir = join(root, "node_modules", ".cache", "vitest-module-loading");
      return existsSync(dir) ? readdirSync(dir) : [];
    },
    run: (withCache: boolean) =>
      execFileSync(process.execPath, [...(withCache ? ["--import", register] : []), entry], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
  };
}

describe("register.ts", () => {
  describe("when a worker exits normally", () => {
    /** @scenario "A later worker reads what an earlier worker saved to disk" */
    it("saves what it learned, and a later process resolves from the saved file", () => {
      const { run, pointPackageAt, cacheFiles } = workspace();

      expect(run(true)).toBe("1");
      expect(cacheFiles()).toHaveLength(2);

      // Resolutions are answered from the saved file, not checked again (see ADR-183).
      pointPackageAt("two.js");
      expect(run(true)).toBe("1");
      expect(run(false)).toBe("2");
    });
  });

  describe("when a forked worker is ended with SIGTERM", () => {
    /** @scenario "A forked worker ended with SIGTERM still saves its cache" */
    it("exits through its exit handler and saves", async () => {
      const { root, exitOnSigterm, register, cacheFiles } = workspace();
      const child = fork(exitOnSigterm, [], {
        cwd: root,
        execArgv: ["--import", register],
        stdio: "ignore",
      });

      await new Promise((resolve) => child.once("exit", resolve));

      expect(cacheFiles()).toHaveLength(2);
    });
  });
});
