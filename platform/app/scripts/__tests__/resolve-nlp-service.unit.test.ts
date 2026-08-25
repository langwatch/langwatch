/**
 * @vitest-environment node
 *
 * Tests for dev/scripts/lib/resolve-nlp-service.sh, sourced the way
 * platform/app/scripts/start.sh sources it: before the launcher decides which
 * port to start the Go NLP engine on. The launcher runs ahead of every Node
 * entry point and sees only the calling shell, while the app loads .env (then
 * the .env.portless haven overlay) with override, so the helper has to read
 * those files to predict the address the app will actually dial.
 *
 * See specs/setup/dev-nlp-engine-port.feature.
 *
 * The helper is bash; we drive it by sourcing it from `bash -s` and reading the
 * resulting env, the same technique as derive-gateway-base-url.unit.test.ts.
 */

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const HELPER = path.join(REPO_ROOT, "dev/scripts/lib/resolve-nlp-service.sh");

const appDirs: string[] = [];

function appDirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "resolve-nlp-service-"));
  appDirs.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), contents);
  }
  return dir;
}

afterEach(() => {
  while (appDirs.length) {
    rmSync(appDirs.pop()!, { recursive: true, force: true });
  }
});

function runHelper({
  appDir,
  env = {},
}: {
  appDir: string;
  env?: Record<string, string | undefined>;
}): { stdout: string; nlpService: string; exitCode: number } {
  const exports = Object.entries(env)
    .map(([k, v]) =>
      v === undefined ? `unset ${k}` : `export ${k}='${v.replace(/'/g, "'\\''")}'`,
    )
    .join("\n");
  const script = `
set -e
${exports}
. "${HELPER}"
resolve_nlp_service "${appDir}"
echo "__LANGWATCH_NLP_SERVICE=\${LANGWATCH_NLP_SERVICE:-}"
`;
  let stdout = "";
  let exitCode = 0;
  try {
    stdout = execSync("bash -s", {
      encoding: "utf8",
      input: script,
      stdio: ["pipe", "pipe", "pipe"],
      // Isolate the subprocess env: LANGWATCH_NLP_SERVICE is set in the
      // developer's own shell often enough that inheriting it would make these
      // assertions depend on the machine.
      env: { PATH: process.env.PATH ?? "" },
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    exitCode = err.status ?? 1;
    stdout = (err.stdout ?? "") + (err.stderr ?? "");
  }
  const nlpService = stdout.match(/__LANGWATCH_NLP_SERVICE=(.*)/)?.[1] ?? "";
  return { stdout, nlpService, exitCode };
}

describe("resolve-nlp-service.sh", () => {
  describe("given the app's env file pins an address", () => {
    /** @scenario "The engine follows the address pinned in the app's env file" */
    it("resolves the pinned address rather than this worktree's port slot", () => {
      const appDir = appDirWith({
        ".env": 'PORT=5560\nLANGWATCH_NLP_SERVICE="http://localhost:5571"\n',
      });

      const r = runHelper({
        appDir,
        env: { PORT: "5590", LANGWATCH_NLP_SERVICE: undefined },
      });

      expect(r.exitCode).toBe(0);
      expect(r.nlpService).toBe("http://localhost:5571");
    });

    /** @scenario "The engine follows the address pinned in the app's env file" */
    it("names the file it read the address from", () => {
      const appDir = appDirWith({
        ".env": 'LANGWATCH_NLP_SERVICE="http://localhost:5571"\n',
      });

      const r = runHelper({ appDir });

      expect(r.stdout).toMatch(/LANGWATCH_NLP_SERVICE=http:\/\/localhost:5571/);
      expect(r.stdout).toMatch(/from \.env/);
    });

    /** @scenario "An address pinned in a file beats one exported for a single run" */
    it("keeps the pinned address over one exported into the shell", () => {
      const appDir = appDirWith({
        ".env": 'LANGWATCH_NLP_SERVICE="http://localhost:5571"\n',
      });

      const r = runHelper({
        appDir,
        env: { LANGWATCH_NLP_SERVICE: "http://localhost:5591" },
      });

      expect(r.nlpService).toBe("http://localhost:5571");
    });

    it("reads an unquoted value with an inline comment", () => {
      const appDir = appDirWith({
        ".env": "LANGWATCH_NLP_SERVICE=http://localhost:5571 # the engine\n",
      });

      const r = runHelper({ appDir });

      expect(r.nlpService).toBe("http://localhost:5571");
    });

    it("reads an external host the same way, so no local engine is started", () => {
      const appDir = appDirWith({
        ".env": "LANGWATCH_NLP_SERVICE='https://nlp.example.internal'\n",
      });

      const r = runHelper({ appDir });

      expect(r.nlpService).toBe("https://nlp.example.internal");
    });
  });

  describe("given a haven overlay alongside the env file", () => {
    /** @scenario "The haven overlay wins over the plain env file" */
    it("resolves the overlay's address, the one the app loads last", () => {
      const appDir = appDirWith({
        ".env": 'LANGWATCH_NLP_SERVICE="http://localhost:5571"\n',
        ".env.portless": 'LANGWATCH_NLP_SERVICE="http://nlp.plum.langwatch.localhost"\n',
      });

      const r = runHelper({ appDir });

      expect(r.nlpService).toBe("http://nlp.plum.langwatch.localhost");
    });
  });

  describe("given nothing pins an address", () => {
    /** @scenario "Nothing pinned leaves the launcher to derive the port slot" */
    it("leaves the address unset for the launcher to derive", () => {
      const appDir = appDirWith({ ".env": "PORT=5560\n" });

      const r = runHelper({ appDir });

      expect(r.exitCode).toBe(0);
      expect(r.nlpService).toBe("");
    });

    /** @scenario "Nothing pinned leaves the launcher to derive the port slot" */
    it("says nothing", () => {
      const appDir = appDirWith({ ".env": "PORT=5560\n" });

      const r = runHelper({ appDir });

      expect(r.stdout).not.toMatch(/nlpgo:/);
    });

    /** @scenario "A commented-out pin is not an address" */
    it("ignores a commented-out pin", () => {
      const appDir = appDirWith({
        ".env": '# LANGWATCH_NLP_SERVICE="http://localhost:5571"\n',
      });

      const r = runHelper({ appDir });

      expect(r.nlpService).toBe("");
    });

    it("survives an app directory with no env file at all", () => {
      const appDir = appDirWith({});

      const r = runHelper({ appDir });

      expect(r.exitCode).toBe(0);
      expect(r.nlpService).toBe("");
    });
  });
});
