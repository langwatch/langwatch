/**
 * @vitest-environment node
 *
 * Tests for scripts/lib/sanitize-dev-env.sh — guards lw#3453 ("make
 * quickstart" on a worktree where APP_PORT != 5560 must not 403 on login
 * because of a stale localhost-pinned NEXTAUTH_URL inherited from a prior
 * shell). Real proxy-style overrides (boxd, ngrok, https) must pass
 * through untouched.
 *
 * The helper is bash; we drive it by sourcing it from `bash -c` and
 * reading the resulting env.
 */

import { execSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const HELPER = path.join(REPO_ROOT, "scripts/lib/sanitize-dev-env.sh");

function runHelper(env: Record<string, string | undefined>): {
  stdout: string;
  nextauthUrl: string;
  baseHost: string;
  exitCode: number;
} {
  const exports = Object.entries(env)
    .map(([k, v]) =>
      v === undefined ? `unset ${k}` : `export ${k}='${v.replace(/'/g, "'\\''")}'`,
    )
    .join("\n");
  const script = `
set -e
${exports}
. "${HELPER}"
sanitize_localhost_dev_env
echo "__NEXTAUTH_URL=\${NEXTAUTH_URL:-}"
echo "__BASE_HOST=\${BASE_HOST:-}"
`;
  let stdout = "";
  let exitCode = 0;
  try {
    stdout = execSync("bash -s", {
      encoding: "utf8",
      input: script,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    exitCode = err.status ?? 1;
    stdout = (err.stdout ?? "") + (err.stderr ?? "");
  }
  const nextauthUrl = stdout.match(/__NEXTAUTH_URL=(.*)/)?.[1] ?? "";
  const baseHost = stdout.match(/__BASE_HOST=(.*)/)?.[1] ?? "";
  return { stdout, nextauthUrl, baseHost, exitCode };
}

describe("sanitize-dev-env.sh (lw#3453)", () => {
  describe("when stale localhost values are inherited from a prior session", () => {
    /** @scenario sanitize rewrites stale localhost NEXTAUTH_URL to current APP_PORT */
    it("rewrites NEXTAUTH_URL to the current APP_PORT", () => {
      const r = runHelper({ APP_PORT: "5562", NEXTAUTH_URL: "http://localhost:5560" });
      expect(r.exitCode).toBe(0);
      expect(r.nextauthUrl).toBe("http://localhost:5562");
    });

    /** @scenario sanitize rewrites stale localhost BASE_HOST to current APP_PORT */
    it("rewrites BASE_HOST to the current APP_PORT", () => {
      const r = runHelper({ APP_PORT: "5562", BASE_HOST: "http://localhost:5560" });
      expect(r.exitCode).toBe(0);
      expect(r.baseHost).toBe("http://localhost:5562");
    });

    it("emits a one-line log per overwrite so users see what happened", () => {
      const r = runHelper({ APP_PORT: "5562", NEXTAUTH_URL: "http://localhost:5560" });
      expect(r.stdout).toMatch(/rewriting stale NEXTAUTH_URL=http:\/\/localhost:5560/);
    });
  });

  describe("when the env var is unset", () => {
    /** @scenario sanitize fills NEXTAUTH_URL from APP_PORT when unset */
    it("fills NEXTAUTH_URL from APP_PORT", () => {
      const r = runHelper({ APP_PORT: "5562", NEXTAUTH_URL: undefined });
      expect(r.exitCode).toBe(0);
      expect(r.nextauthUrl).toBe("http://localhost:5562");
    });

    it("fills BASE_HOST from APP_PORT", () => {
      const r = runHelper({ APP_PORT: "5562", BASE_HOST: undefined });
      expect(r.exitCode).toBe(0);
      expect(r.baseHost).toBe("http://localhost:5562");
    });
  });

  describe("when a real (non-localhost) override is exported", () => {
    /** @scenario sanitize leaves https boxd-proxy NEXTAUTH_URL untouched */
    it("leaves https://*.boxd.sh NEXTAUTH_URL alone (boxd proxy path)", () => {
      const r = runHelper({
        APP_PORT: "5562",
        NEXTAUTH_URL: "https://langwatch-fork.boxd.sh",
      });
      expect(r.nextauthUrl).toBe("https://langwatch-fork.boxd.sh");
    });

    /** @scenario sanitize leaves a 127.0.0.1 NEXTAUTH_URL untouched */
    it("leaves http://127.0.0.1:* NEXTAUTH_URL alone (treated as override)", () => {
      const r = runHelper({
        APP_PORT: "5562",
        NEXTAUTH_URL: "http://127.0.0.1:5560",
      });
      expect(r.nextauthUrl).toBe("http://127.0.0.1:5560");
    });

    /** @scenario sanitize leaves a non-localhost http override untouched */
    it("leaves http://abc.ngrok.io NEXTAUTH_URL alone (tunnel override)", () => {
      const r = runHelper({
        APP_PORT: "5562",
        NEXTAUTH_URL: "http://abc123.ngrok.io",
      });
      expect(r.nextauthUrl).toBe("http://abc123.ngrok.io");
    });
  });

  describe("when APP_PORT is not set", () => {
    /** @scenario sanitize warns and returns nonzero when APP_PORT is unset */
    it("warns and returns nonzero so the launcher can fail loudly", () => {
      const r = runHelper({ APP_PORT: undefined });
      expect(r.exitCode).not.toBe(0);
      expect(r.stdout).toMatch(/APP_PORT/);
    });
  });

  describe("when stale URL already matches the current port", () => {
    /** @scenario sanitize is a noop when stale URL already matches current port */
    it("does not log a rewrite (idempotent)", () => {
      const r = runHelper({
        APP_PORT: "5562",
        NEXTAUTH_URL: "http://localhost:5562",
      });
      expect(r.stdout).not.toMatch(/rewriting stale/);
      expect(r.nextauthUrl).toBe("http://localhost:5562");
    });
  });
});
