import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertGatewaySecretsAllOrNone, createEnvConfig } from "../env-create.mjs";

// Regression for iter-110: gateway secrets set partially (e.g. only
// LW_VIRTUAL_KEY_PEPPER, missing the two HMAC/JWT secrets) let the server
// boot cleanly but caused /api/internal/gateway/* to return 503 minutes
// later at first VK request. Hard-failing at import time (via this
// assertion, called from env-create after createEnv) surfaces the misconfig
// immediately on start + covers workers.ts too (which otherwise only ran
// verifyRedisReady at boot).
describe("assertGatewaySecretsAllOrNone", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("passes when none of the three secrets are set (deployment doesn't use the gateway)", () => {
    expect(() => assertGatewaySecretsAllOrNone({})).not.toThrow();
  });

  it("passes when all three secrets are set", () => {
    expect(() =>
      assertGatewaySecretsAllOrNone({
        LW_VIRTUAL_KEY_PEPPER: "a".repeat(32),
        LW_GATEWAY_INTERNAL_SECRET: "b".repeat(32),
        LW_GATEWAY_JWT_SECRET: "c".repeat(32),
      }),
    ).not.toThrow();
  });

  it("throws when only one of the three is set", () => {
    expect(() =>
      assertGatewaySecretsAllOrNone({
        LW_VIRTUAL_KEY_PEPPER: "a".repeat(32),
      }),
    ).toThrow(/partial config/i);
  });

  it("throws when two of the three are set (the latent-503 case from iter-110)", () => {
    expect(() =>
      assertGatewaySecretsAllOrNone({
        LW_VIRTUAL_KEY_PEPPER: "a".repeat(32),
        LW_GATEWAY_INTERNAL_SECRET: "b".repeat(32),
      }),
    ).toThrow(/partial config.*LW_GATEWAY_JWT_SECRET/i);
  });

  it("lists the missing keys in the thrown message so the dev knows what to add", () => {
    try {
      assertGatewaySecretsAllOrNone({
        LW_GATEWAY_INTERNAL_SECRET: "b".repeat(32),
      });
      expect.fail("expected partial-config throw");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/LW_VIRTUAL_KEY_PEPPER/);
      expect(msg).toMatch(/LW_GATEWAY_JWT_SECRET/);
      expect(msg).not.toMatch(/LW_GATEWAY_INTERNAL_SECRET.*missing/);
    }
  });

  it("prints a loud banner to stderr before throwing", () => {
    expect(() =>
      assertGatewaySecretsAllOrNone({
        LW_VIRTUAL_KEY_PEPPER: "a".repeat(32),
      }),
    ).toThrow();
    const banner = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(banner).toMatch(/AI Gateway secrets are partially configured/i);
    expect(banner).toMatch(/openssl rand -hex 32/);
  });
});

// Regression for iter-111 QA finding: `createEnvConfig()` used to pass the
// t3-env proxy object (_env) to assertGatewaySecretsAllOrNone. Touching any
// of the server-only gateway secret keys on that proxy from the Vite client
// bundle throws "Attempted to access a server-side environment variable on
// the client" — the whole app fails to hydrate, blank page, console has one
// error. Fix: skip the guard entirely when `typeof window !== "undefined"`
// and read from `process.env` directly (not the proxy) on the server.
describe("createEnvConfig — client-safe guard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does NOT throw when imported into a browser-like env (window defined)", () => {
    vi.stubGlobal("window", {});
    // Even with a half-configured gateway env, the client bundle must
    // still hydrate — the guard belongs on the server entry points.
    const original = process.env.LW_VIRTUAL_KEY_PEPPER;
    process.env.LW_VIRTUAL_KEY_PEPPER = "a".repeat(32);
    try {
      expect(() => createEnvConfig()).not.toThrow();
    } finally {
      if (original === undefined) {
        delete process.env.LW_VIRTUAL_KEY_PEPPER;
      } else {
        process.env.LW_VIRTUAL_KEY_PEPPER = original;
      }
    }
  });
});
