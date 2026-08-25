import fs from "node:fs";
import path from "node:path";
import { createEnv } from "@t3-oss/env-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertGatewaySecretsAllOrNone,
  azureBlobAuthModeSchema,
  createEnvConfig,
  gatewaySecretsSchema,
  rumSampleRatioSchema,
  storedObjectsBackendSchema,
} from "../env-create.mjs";

// Regression for iter-110: gateway secrets set partially (e.g. only
// LW_VIRTUAL_KEY_PEPPER, missing the two HMAC/JWT secrets) let the server
// boot cleanly but caused /api/internal/gateway/* to return 503 minutes
// later at first VK request. Hard-failing at import time (via this
// assertion, called from env-create after createEnv) surfaces the misconfig
// immediately during explicit executable boot, including workers.
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
    const banner = errorSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
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
      expect(() => createEnvConfig(process.env)).not.toThrow();
    } finally {
      if (original === undefined) {
        delete process.env.LW_VIRTUAL_KEY_PEPPER;
      } else {
        process.env.LW_VIRTUAL_KEY_PEPPER = original;
      }
    }
  });
});

// Regression for issue #3903 Friction #2: the .env.example sentinel value
// "REPLACE_ME" is only 10 chars — deliberately shorter than min(32) — so Zod
// itself rejects it at boot without a bespoke length-equality guard.
// This test exercises the REAL gatewaySecretsSchema exported from env-create.mjs
// (not an inline copy), so a mutation of min(32) → min(1) in production will
// cause this test to fail because "REPLACE_ME" (10 chars) would pass min(1).
//
// Note: @t3-oss/env-core logs issues to console.error but the thrown error
// message is the fixed string "Invalid environment variables" — the field names
// appear in the logged issues, not in the thrown string. "REPLACE_ME" itself is
// not surfaced in the Zod output (only the path + minimum constraint are logged) —
// this is asserted as a security contract below. The user sees which keys are
// invalid and the min(32) constraint, and the .env.example comment instructs
// them to run `openssl rand -hex 32`.
describe("gatewaySecretsSchema", () => {
  describe("given LW_GATEWAY_* equal the .env.example REPLACE_ME sentinel", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    /** @scenario First-run env validation surfaces a self-documenting error for unset gateway secrets */
    it("throws a Zod min(32) error naming the sentinel value", () => {
      // Call createEnv with the real gatewaySecretsSchema imported from env-create.mjs.
      // This exercises the actual min(32) constraint — NOT an inline copy — so a
      // mutation of min(32) → min(1) in env-create.mjs will cause this test to fail.
      expect(() =>
        createEnv({
          clientPrefix: "VITE_PUBLIC_",
          client: {},
          server: {
            LW_VIRTUAL_KEY_PEPPER: gatewaySecretsSchema.LW_VIRTUAL_KEY_PEPPER,
            LW_GATEWAY_INTERNAL_SECRET: gatewaySecretsSchema.LW_GATEWAY_INTERNAL_SECRET,
            LW_GATEWAY_JWT_SECRET: gatewaySecretsSchema.LW_GATEWAY_JWT_SECRET,
          },
          runtimeEnv: {
            LW_VIRTUAL_KEY_PEPPER: "REPLACE_ME",
            LW_GATEWAY_INTERNAL_SECRET: "REPLACE_ME",
            LW_GATEWAY_JWT_SECRET: "REPLACE_ME",
          },
          skipValidation: false,
        }),
      ).toThrow("Invalid environment variables");

      // The issues logged to console.error contain the field names and the
      // minimum constraint so the user can identify which keys need real secrets.
      const logged = errorSpy.mock.calls
        .map((c: unknown[]) =>
          c.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "),
        )
        .join("\n");
      expect(logged).toMatch(/LW_VIRTUAL_KEY_PEPPER/);
      expect(logged).toMatch(/LW_GATEWAY_INTERNAL_SECRET/);
      expect(logged).toMatch(/LW_GATEWAY_JWT_SECRET/);
      // "32" appears as the minimum constraint value in the logged issues
      expect(logged).toMatch(/32/);
      // Security contract: Zod must NOT leak the placeholder value into the
      // logged issues. If a future Zod/t3-env release starts echoing the
      // received value, this assertion will fail — that's the trip-wire.
      expect(logged).not.toMatch(/REPLACE_ME/);
    });
  });
});

// Binds the spec scenario "A nonsensical share records rather than silently
// collecting nothing" (specs/observability/browser-rum-trace-correlation.feature)
// to the path a deployment actually takes. `SessionRatioSampler` clamps a
// nonsense ratio too, but nothing out of range could ever reach it: the env
// schema rejected the value first and `createEnv` turned that into a boot
// failure, so a typo in an optional telemetry dial took the whole app down.
// This exercises the real exported schema, so dropping the `.catch` fails here.
describe("rumSampleRatioSchema", () => {
  describe("given a share that cannot be read as a ratio", () => {
    it.each([
      ["a word", "banana"],
      ["a ratio above one", "2"],
      ["a negative ratio", "-1"],
      ["blank, which is how an unset .env line reads", ""],
    ])("records everything rather than refusing to boot on %s", (_case, value) => {
      const parsed = rumSampleRatioSchema.safeParse(value);

      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data).toBe(1);
    });
  });

  describe("given a share that reads as a ratio", () => {
    it.each([
      ["a fraction", "0.25", 0.25],
      ["zero, which is a deliberate choice rather than nonsense", "0", 0],
      ["one", "1", 1],
    ])("honours %s", (_case, value, expected) => {
      expect(rumSampleRatioSchema.parse(value)).toBe(expected);
    });
  });
});

// Binds the spec scenarios "The env schema declares the Azure backend
// variables as first-class keys" and "An unrecognized STORED_OBJECTS_BACKEND
// value is rejected, not ignored" (AC37, issue #4133) to the real exported
// schema — not an inline copy — so a mutation of the enum widening it back to
// a free string fails here.
describe("storedObjectsBackendSchema", () => {
  describe("given the env-create source", () => {
    /** @scenario "The env schema declares the Azure backend variables as first-class keys" */
    it("declares STORED_OBJECTS_BACKEND and AZURE_BLOB_CONTAINER in both the schema and the runtime map", () => {
      const source = fs.readFileSync(
        path.join(__dirname, "..", "env-create.mjs"),
        "utf-8",
      );
      // Both keys must be first-class env vars: declared in the zod server
      // schema AND wired through runtimeEnv — otherwise application code
      // would have to reach into the raw source outside executable boot.
      // Assert the two DECLARATIONS, not how many times the name appears —
      // a comment mentioning the variable twice would satisfy a count.
      expect(source).toMatch(/STORED_OBJECTS_BACKEND:\s*storedObjectsBackendSchema/);
      expect(source).toMatch(
        /AZURE_BLOB_CONTAINER:\s*z\s*\n?\s*\.string\(\)|AZURE_BLOB_CONTAINER:\s*z\.string\(\)/,
      );
      expect(source).toMatch(/STORED_OBJECTS_BACKEND:\s*source\.STORED_OBJECTS_BACKEND/);
      expect(source).toMatch(/AZURE_BLOB_CONTAINER:\s*source\.AZURE_BLOB_CONTAINER/);
    });
  });

  describe("given a supported value", () => {
    it.each([["s3"], ["azure"]])("accepts %s", (value) => {
      const parsed = storedObjectsBackendSchema.safeParse(value);
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data).toBe(value);
    });
  });

  describe("given no value", () => {
    /** @scenario "Azure env vars alone never flip the write destination" */
    it("is optional — undefined is valid, not defaulted to azure or s3", () => {
      const parsed = storedObjectsBackendSchema.safeParse(undefined);
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data).toBeUndefined();
    });
  });

  describe("given a value outside the supported set", () => {
    /** @scenario "An unrecognized STORED_OBJECTS_BACKEND value is rejected, not ignored" */
    it("fails validation rather than passing the value through untouched", () => {
      const parsed = storedObjectsBackendSchema.safeParse("gcs");
      expect(parsed.success).toBe(false);
    });

    /** @scenario "An unrecognized STORED_OBJECTS_BACKEND value is rejected, not ignored" */
    it("startup fails via createEnv, naming the variable and the supported values", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        expect(() =>
          createEnv({
            clientPrefix: "VITE_PUBLIC_",
            client: {},
            server: { STORED_OBJECTS_BACKEND: storedObjectsBackendSchema },
            runtimeEnv: { STORED_OBJECTS_BACKEND: "gcs" },
            skipValidation: false,
          }),
        ).toThrow("Invalid environment variables");

        const logged = errorSpy.mock.calls
          .map((c: unknown[]) =>
            c
              .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
              .join(" "),
          )
          .join("\n");
        expect(logged).toMatch(/STORED_OBJECTS_BACKEND/);
        expect(logged).toMatch(/s3/);
        expect(logged).toMatch(/azure/);
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});

// Binds the spec scenario "An unrecognized AZURE_BLOB_AUTH_MODE value is
// rejected, not ignored" (issue #6087) to the real exported schema — not an
// inline copy — so a mutation of the enum widening it back to a free string
// fails here, mirroring the storedObjectsBackendSchema coverage above.
describe("azureBlobAuthModeSchema", () => {
  describe("given the env-create source", () => {
    it("declares AZURE_BLOB_AUTH_MODE in both the schema and the runtime map", () => {
      const source = fs.readFileSync(
        path.join(__dirname, "..", "env-create.mjs"),
        "utf-8",
      );
      // The declaration and the runtime wiring, not how many times the name
      // appears — a comment mentioning it twice would satisfy a count, which
      // is the assertion the sibling test above deliberately avoids.
      expect(source).toMatch(/AZURE_BLOB_AUTH_MODE:\s*azureBlobAuthModeSchema/);
      expect(source).toMatch(/AZURE_BLOB_AUTH_MODE:\s*source\.AZURE_BLOB_AUTH_MODE/);
    });
  });

  describe("given a supported value", () => {
    it.each([["sharedKey"], ["workloadIdentity"], ["managedIdentity"], ["azureCli"]])(
      "accepts %s",
      (value) => {
        const parsed = azureBlobAuthModeSchema.safeParse(value);
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data).toBe(value);
      },
    );
  });

  describe("given no value", () => {
    it("is optional — undefined is valid, not defaulted to a specific mode", () => {
      const parsed = azureBlobAuthModeSchema.safeParse(undefined);
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data).toBeUndefined();
    });
  });

  describe("given a value outside the supported set", () => {
    /** @scenario "An unrecognized AZURE_BLOB_AUTH_MODE value is rejected, not ignored" */
    it("fails validation rather than passing the value through untouched", () => {
      const parsed = azureBlobAuthModeSchema.safeParse("apiKey");
      expect(parsed.success).toBe(false);
    });

    /** @scenario "An unrecognized AZURE_BLOB_AUTH_MODE value is rejected, not ignored" */
    it("startup fails via createEnv, naming the variable and the supported values", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        expect(() =>
          createEnv({
            clientPrefix: "VITE_PUBLIC_",
            client: {},
            server: { AZURE_BLOB_AUTH_MODE: azureBlobAuthModeSchema },
            runtimeEnv: { AZURE_BLOB_AUTH_MODE: "apiKey" },
            skipValidation: false,
          }),
        ).toThrow("Invalid environment variables");

        const logged = errorSpy.mock.calls
          .map((c: unknown[]) =>
            c
              .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
              .join(" "),
          )
          .join("\n");
        expect(logged).toMatch(/AZURE_BLOB_AUTH_MODE/);
        expect(logged).toMatch(/sharedKey/);
        expect(logged).toMatch(/workloadIdentity/);
        expect(logged).toMatch(/managedIdentity/);
        expect(logged).toMatch(/azureCli/);
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
