/**
 * Regression tests for issue #4755: revoking an ingestion key on the
 * platform silently bricks CLI Path B telemetry because the wrapper
 * reuses a locally cached key forever.
 *
 * Contract under test:
 *   1. wrapper-mode: before reusing a cached key, call listIngestionKeys;
 *      derive the cached token's lookupId (format `ik-lw-{16-char lookupId}_{secret}`);
 *      if the server list resolves and the lookupId is not found for that
 *      sourceType → mint a fresh key and persist it.
 *   2. wrapper-mode: if listIngestionKeys rejects → reuse the cache as-is
 *      (offline fallback).
 *   3. login-flow: after a successful device_session login, reconcile
 *      default_personal_ingest_keys — drop entries whose lookupId is not
 *      in the live list, keep ones that are.
 */
import {
  afterEach,

  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as cliApi from "../cli-api";
import * as configMod from "../config";
import type { GovernanceConfig } from "../config";

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("../cli-api", async () => {
  const actual = await vi.importActual<typeof cliApi>("../cli-api");
  return {
    ...actual,
    mintIngestionKey: vi.fn(),
    listIngestionKeys: vi.fn(),
    getCliBootstrap: vi.fn(),
  };
});

vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof configMod>("../config");
  return {
    ...actual,
    saveConfig: vi.fn(),
    loadConfig: vi.fn(),
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function baseCfg(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return {
    gateway_url: "http://gw.example.com",
    control_plane_url: "http://app.example.com",
    access_token: "tok",
    user: { id: "u1", email: "u@example.com", name: "U" },
    organization: { id: "o1", slug: "acme" },
    ...overrides,
  };
}

/**
 * Construct a realistic cached ingestion token from a lookupId.
 * Format: `ik-lw-{16-char lookupId}_{secret}`
 */
function makeToken({
  lookupId,
  secret = "realsecret0000000000000000000000",
}: {
  lookupId: string;
  secret?: string;
}): string {
  return `ik-lw-${lookupId}_${secret}`;
}

afterEach(() => {
  vi.clearAllMocks();
});

// ─── wrapper-mode: stale cache detection ─────────────────────────────────────

describe("resolveWrapperMode", () => {
  describe("given a cached ingest key", () => {
    describe("when the key is no longer live on the platform", () => {
      it("mints a fresh key, uses the new token, and persists it over the stale cache entry", async () => {
        const { resolveWrapperMode } = await import("../wrapper-mode.js");

        const staleLookupId = "aabbccdd11223344";
        const staleToken = makeToken({ lookupId: staleLookupId });

        const cfg = baseCfg({
          default_personal_ingest_keys: {
            codex: { secret: staleToken, prefix: "ik-lw-aabb" },
          },
        });

        // Server returns an empty list — no live key for this sourceType
        (cliApi.listIngestionKeys as ReturnType<typeof vi.fn>).mockResolvedValue(
          [],
        );

        (cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
          token: "ik-lw-newlookupid0000_freshsecret000000000000000",
          prefix: "ik-lw-newl",
          endpoint: "http://app.example.com/api/otel",
        });

        const out = await resolveWrapperMode(cfg, "codex", {});

        // Fresh key is used for OTEL transport
        expect(out.mode).toBe("ingestion");
        expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toContain(
          "ik-lw-newlookupid0000_freshsecret000000000000000",
        );
        expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).not.toContain(staleToken);

        // A fresh mint was triggered
        expect(cliApi.mintIngestionKey).toHaveBeenCalledWith(
          expect.any(Object),
          "codex",
        );

        // The new key was persisted, overwriting the stale cache entry
        expect(configMod.saveConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            default_personal_ingest_keys: expect.objectContaining({
              codex: expect.objectContaining({
                secret: "ik-lw-newlookupid0000_freshsecret000000000000000",
              }),
            }),
          }),
        );
      });

      it("mints a fresh key when the server returns a different lookupId for that sourceType", async () => {
        const { resolveWrapperMode } = await import("../wrapper-mode.js");

        const cachedLookupId = "aabbccdd11223344";
        const liveLookupId = "zzzzzzzz99999999"; // different — the old one was revoked
        const staleToken = makeToken({ lookupId: cachedLookupId });

        const cfg = baseCfg({
          default_personal_ingest_keys: {
            codex: { secret: staleToken, prefix: "ik-lw-aabb" },
          },
        });

        (cliApi.listIngestionKeys as ReturnType<typeof vi.fn>).mockResolvedValue(
          [{ sourceType: "codex", lookupId: liveLookupId }],
        );

        (cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
          token: makeToken({ lookupId: liveLookupId, secret: "freshsecret000000000000000000000" }),
          prefix: "ik-lw-zzzz",
          endpoint: "http://app.example.com/api/otel",
        });

        const out = await resolveWrapperMode(cfg, "codex", {});

        expect(out.mode).toBe("ingestion");
        expect(cliApi.mintIngestionKey).toHaveBeenCalled();
        expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).not.toContain(staleToken);
      });
    });

    describe("when the key is still live on the platform (lookupId matches)", () => {
      it("reuses the cached token and does NOT call mintIngestionKey", async () => {
        const { resolveWrapperMode } = await import("../wrapper-mode.js");

        const lookupId = "aabbccdd11223344";
        const cachedToken = makeToken({ lookupId });

        const cfg = baseCfg({
          default_personal_ingest_keys: {
            codex: { secret: cachedToken, prefix: "ik-lw-aabb" },
          },
        });

        // Server confirms the same lookupId is still live
        (cliApi.listIngestionKeys as ReturnType<typeof vi.fn>).mockResolvedValue(
          [{ sourceType: "codex", lookupId }],
        );

        const out = await resolveWrapperMode(cfg, "codex", {});

        expect(out.mode).toBe("ingestion");
        expect(out.newKeyMinted).toBe(false);
        expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toContain(cachedToken);
        expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
      });
    });

    describe("when listIngestionKeys rejects (network error / older server)", () => {
      it("falls back to the cached token without minting (offline fallback)", async () => {
        const { resolveWrapperMode } = await import("../wrapper-mode.js");

        const lookupId = "aabbccdd11223344";
        const cachedToken = makeToken({ lookupId });

        const cfg = baseCfg({
          default_personal_ingest_keys: {
            codex: { secret: cachedToken, prefix: "ik-lw-aabb" },
          },
        });

        (cliApi.listIngestionKeys as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error("fetch failed"),
        );

        const out = await resolveWrapperMode(cfg, "codex", {});

        expect(out.mode).toBe("ingestion");
        expect(out.newKeyMinted).toBe(false);
        expect(out.vars.OTEL_EXPORTER_OTLP_HEADERS).toContain(cachedToken);
        expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
      });
    });
  });
});

// ─── login-flow: stale cache reconciliation ───────────────────────────────────

describe("runUnifiedLoginFlow", () => {
  describe("given default_personal_ingest_keys in the config after a successful device_session login", () => {
    describe("when some cached keys are no longer live on the platform", () => {
      it("removes stale entries whose lookupId is absent from the live list", async () => {
        // We exercise the real login-flow code path with all external
        // dependencies mocked at module boundaries.
        const deviceFlow = await import("../device-flow.js");
        const loginFlow = await import("../login-flow.js");

        const liveLookupId = "live0000live0000";
        const staleLookupId = "dead0000dead0000";

        const liveToken = makeToken({ lookupId: liveLookupId });
        const staleToken = makeToken({ lookupId: staleLookupId });

        const cfg = baseCfg({
          default_personal_ingest_keys: {
            codex: { secret: liveToken, prefix: "ik-lw-live" },
            claude_code: { secret: staleToken, prefix: "ik-lw-dead" },
          },
        });

        // Mock device-flow layer
        vi.spyOn(deviceFlow, "startDeviceCode").mockResolvedValue({
          device_code: "dc",
          user_code: "USER-CODE",
          verification_uri: "http://app.example.com/device",
          verification_uri_complete: "http://app.example.com/device?code=USER-CODE",
          expires_in: 300,
          interval: 5,
        });

        vi.spyOn(deviceFlow, "pollUntilDone").mockResolvedValue({
          kind: "device_session",
          access_token: "tok-new",
          refresh_token: "rtok",
          expires_in: 3600,
          user: { id: "u1", email: "u@example.com", name: "U" },
          organization: { id: "o1", slug: "acme", name: "Acme" },
          default_personal_vk: undefined,
        });

        // listIngestionKeys returns only the live key
        (cliApi.listIngestionKeys as ReturnType<typeof vi.fn>).mockResolvedValue(
          [{ sourceType: "codex", lookupId: liveLookupId }],
        );

        // getCliBootstrap returns minimal shape (no gatewayUrl / toolPolicies)
        (cliApi.getCliBootstrap as ReturnType<typeof vi.fn>).mockResolvedValue(
          null,
        );

        (configMod.loadConfig as ReturnType<typeof vi.fn>).mockReturnValue(cfg);

        // Suppress console output during test
        vi.spyOn(console, "log").mockImplementation(() => undefined);

        await loginFlow.runUnifiedLoginFlow({ kind: "device_session", cfg });

        // saveConfig must have been called with claude_code removed (stale)
        // and codex retained (live)
        const savedCfgs: GovernanceConfig[] = (
          configMod.saveConfig as ReturnType<typeof vi.fn>
        ).mock.calls.map((call: unknown[]) => call[0] as GovernanceConfig);

        // Find the reconcile save — it's the one that drops claude_code
        const reconcileSave = savedCfgs.find(
          (c) =>
            c.default_personal_ingest_keys !== undefined &&
            !("claude_code" in (c.default_personal_ingest_keys ?? {})),
        );

        expect(reconcileSave).toBeDefined();
        expect(
          reconcileSave!.default_personal_ingest_keys!.codex,
        ).toBeDefined();
        expect(
          reconcileSave!.default_personal_ingest_keys!.claude_code,
        ).toBeUndefined();
      });

      it("keeps live entries that are still valid on the platform", async () => {
        const deviceFlow = await import("../device-flow.js");
        const loginFlow = await import("../login-flow.js");

        const liveLookupId = "live0000live0000";
        const liveToken = makeToken({ lookupId: liveLookupId });

        const cfg = baseCfg({
          default_personal_ingest_keys: {
            codex: { secret: liveToken, prefix: "ik-lw-live" },
          },
        });

        vi.spyOn(deviceFlow, "startDeviceCode").mockResolvedValue({
          device_code: "dc",
          user_code: "USER-CODE",
          verification_uri: "http://app.example.com/device",
          verification_uri_complete: "http://app.example.com/device?code=USER-CODE",
          expires_in: 300,
          interval: 5,
        });

        vi.spyOn(deviceFlow, "pollUntilDone").mockResolvedValue({
          kind: "device_session",
          access_token: "tok-new",
          refresh_token: "rtok",
          expires_in: 3600,
          user: { id: "u1", email: "u@example.com", name: "U" },
          organization: { id: "o1", slug: "acme", name: "Acme" },
          default_personal_vk: undefined,
        });

        (cliApi.listIngestionKeys as ReturnType<typeof vi.fn>).mockResolvedValue(
          [{ sourceType: "codex", lookupId: liveLookupId }],
        );

        (cliApi.getCliBootstrap as ReturnType<typeof vi.fn>).mockResolvedValue(
          null,
        );

        (configMod.loadConfig as ReturnType<typeof vi.fn>).mockReturnValue(cfg);

        vi.spyOn(console, "log").mockImplementation(() => undefined);

        await loginFlow.runUnifiedLoginFlow({ kind: "device_session", cfg });

        const savedCfgs: GovernanceConfig[] = (
          configMod.saveConfig as ReturnType<typeof vi.fn>
        ).mock.calls.map((call: unknown[]) => call[0] as GovernanceConfig);

        // The live codex entry must be present in every save that touches
        // default_personal_ingest_keys
        const keySaves = savedCfgs.filter(
          (c) => c.default_personal_ingest_keys !== undefined,
        );
        for (const saved of keySaves) {
          expect(saved.default_personal_ingest_keys!.codex).toBeDefined();
        }
      });

      it("silently ignores errors from listIngestionKeys during reconcile", async () => {
        const deviceFlow = await import("../device-flow.js");
        const loginFlow = await import("../login-flow.js");

        const lookupId = "live0000live0000";
        const token = makeToken({ lookupId });

        const cfg = baseCfg({
          default_personal_ingest_keys: {
            codex: { secret: token, prefix: "ik-lw-live" },
          },
        });

        vi.spyOn(deviceFlow, "startDeviceCode").mockResolvedValue({
          device_code: "dc",
          user_code: "USER-CODE",
          verification_uri: "http://app.example.com/device",
          verification_uri_complete: "http://app.example.com/device?code=USER-CODE",
          expires_in: 300,
          interval: 5,
        });

        vi.spyOn(deviceFlow, "pollUntilDone").mockResolvedValue({
          kind: "device_session",
          access_token: "tok-new",
          refresh_token: "rtok",
          expires_in: 3600,
          user: { id: "u1", email: "u@example.com", name: "U" },
          organization: { id: "o1", slug: "acme", name: "Acme" },
          default_personal_vk: undefined,
        });

        // Network is down during reconcile
        (cliApi.listIngestionKeys as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error("fetch failed"),
        );

        (cliApi.getCliBootstrap as ReturnType<typeof vi.fn>).mockResolvedValue(
          null,
        );

        (configMod.loadConfig as ReturnType<typeof vi.fn>).mockReturnValue(cfg);

        vi.spyOn(console, "log").mockImplementation(() => undefined);

        // Must not throw even when listIngestionKeys fails
        await expect(
          loginFlow.runUnifiedLoginFlow({ kind: "device_session", cfg }),
        ).resolves.toBeDefined();
      });
    });
  });
});
