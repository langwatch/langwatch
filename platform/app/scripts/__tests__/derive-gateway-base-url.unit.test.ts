/**
 * @vitest-environment node
 *
 * Tests for dev/scripts/lib/derive-gateway-base-url.sh, sourced the same way
 * `make service` / `make service-watch` source it: after .env,
 * so an explicit LW_GATEWAY_BASE_URL (inherited from the shell, or set in
 * .env) always wins over the derived one. Mirrors the PORT + 1000 rule
 * platform/app/scripts/start.sh already uses for `pnpm dev` (the API port
 * Vite proxies to), so a gateway started either way targets the same place.
 *
 * The helper is bash; we drive it by sourcing it from `bash -s` and reading
 * the resulting env, the same technique as sanitize-dev-env.unit.test.ts.
 */

import { execSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const HELPER = path.join(
  REPO_ROOT,
  "dev/scripts/lib/derive-gateway-base-url.sh",
);

function runHelper(env: Record<string, string | undefined>): {
  stdout: string;
  gatewayBaseUrl: string;
  exitCode: number;
} {
  const exports = Object.entries(env)
    .map(([k, v]) =>
      v === undefined
        ? `unset ${k}`
        : `export ${k}='${v.replace(/'/g, "'\\''")}'`,
    )
    .join("\n");
  const script = `
set -e
${exports}
. "${HELPER}"
derive_gateway_base_url
echo "__LW_GATEWAY_BASE_URL=\${LW_GATEWAY_BASE_URL:-}"
`;
  let stdout = "";
  let exitCode = 0;
  try {
    stdout = execSync("bash -s", {
      encoding: "utf8",
      input: script,
      stdio: ["pipe", "pipe", "pipe"],
      // Isolate the subprocess env. The helper reads PORT / LW_GATEWAY_BASE_URL,
      // so any of those present on the parent process (e.g. loaded from the
      // developer's .env) would leak in and make assertions
      // depend on the local machine. Start from a bare PATH and let each
      // test's own export/unset lines be the single source of truth.
      env: { PATH: process.env.PATH ?? "" },
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    exitCode = err.status ?? 1;
    stdout = (err.stdout ?? "") + (err.stderr ?? "");
  }
  const gatewayBaseUrl = stdout.match(/__LW_GATEWAY_BASE_URL=(.*)/)?.[1] ?? "";
  return { stdout, gatewayBaseUrl, exitCode };
}

describe("derive-gateway-base-url.sh", () => {
  describe("when LW_GATEWAY_BASE_URL is unset and PORT is a non-default worktree port", () => {
    /** @scenario "make service derives the control-plane URL from PORT when it is unset" */
    it("derives LW_GATEWAY_BASE_URL as PORT + 1000", () => {
      const r = runHelper({ PORT: "6580", LW_GATEWAY_BASE_URL: undefined });
      expect(r.exitCode).toBe(0);
      expect(r.gatewayBaseUrl).toBe("http://localhost:7580");
    });

    it("prints what it derived", () => {
      const r = runHelper({ PORT: "6580", LW_GATEWAY_BASE_URL: undefined });
      expect(r.stdout).toMatch(/derived from PORT=6580/);
      expect(r.stdout).toMatch(/http:\/\/localhost:7580/);
    });
  });

  describe("when LW_GATEWAY_BASE_URL is already set", () => {
    /** @scenario "make service leaves an explicit control-plane URL untouched" */
    it("leaves the explicit value unchanged, ignoring PORT", () => {
      const r = runHelper({
        PORT: "6580",
        LW_GATEWAY_BASE_URL: "http://elsewhere.internal:9000",
      });
      expect(r.exitCode).toBe(0);
      expect(r.gatewayBaseUrl).toBe("http://elsewhere.internal:9000");
    });

    it("does not print a derivation line", () => {
      const r = runHelper({
        PORT: "6580",
        LW_GATEWAY_BASE_URL: "http://elsewhere.internal:9000",
      });
      expect(r.stdout).not.toMatch(/derived from PORT/);
    });
  });

  describe("when neither PORT nor LW_GATEWAY_BASE_URL is set", () => {
    /** @scenario "make service falls back to the default port pairing when PORT is unset too" */
    it("derives the single-worktree default control-plane URL", () => {
      const r = runHelper({ PORT: undefined, LW_GATEWAY_BASE_URL: undefined });
      expect(r.exitCode).toBe(0);
      expect(r.gatewayBaseUrl).toBe("http://localhost:6560");
    });
  });
});
