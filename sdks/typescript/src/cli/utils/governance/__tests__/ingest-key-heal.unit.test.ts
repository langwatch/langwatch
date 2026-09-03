/**
 * When the healer may re-mint a personal ingest key, and what it rewrites
 * when it does.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { GovernanceConfig } from "../config";
import { type HealDeps, healRevokedIngestKey } from "../ingest-key-heal";

const CACHED = "ik-lw-cached-token";
const FRESH = "ik-lw-fresh-token";

function config(over: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return {
    control_plane_url: "https://app.example.com",
    access_token: "lw_at_session",
    default_personal_ingest_keys: {
      claude_code: { secret: CACHED, prefix: CACHED.slice(0, 12) },
    },
    ...over,
  } as GovernanceConfig;
}

function deps(over: Partial<HealDeps> = {}): HealDeps & {
  saveConfig: ReturnType<typeof vi.fn>;
  resolveLiveIngestionKey: ReturnType<typeof vi.fn>;
  installTelemetryWiring: ReturnType<typeof vi.fn>;
} {
  return {
    loadConfig: () => config(),
    saveConfig: vi.fn(),
    isLoggedIn: (cfg: GovernanceConfig) => Boolean(cfg.access_token),
    resolveLiveIngestionKey: vi.fn().mockResolvedValue({
      token: FRESH,
      prefix: FRESH.slice(0, 12),
      endpoint: "https://app.example.com/api/otel",
      minted: true,
    }),
    installTelemetryWiring: vi.fn().mockReturnValue({
      labels: ["claude telemetry env"],
      warnings: [],
      requiredFailures: [],
    }),
    ...over,
  } as never;
}

describe("healRevokedIngestKey", () => {
  describe("given a signed-in CLI whose cached key was rejected", () => {
    /** @scenario "A rejected personal key is re-minted, rewired and retried" */
    it("re-mints through the resolver, persists the cache, rewires the tool and returns the new target", async () => {
      const d = deps();

      const healed = await healRevokedIngestKey({
        agent: "claude_code",
        rejectedToken: CACHED,
        deps: d,
      });

      expect(d.resolveLiveIngestionKey).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: "claude_code",
          allowOfflineFallback: false,
        }),
      );
      expect(d.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          default_personal_ingest_keys: expect.objectContaining({
            claude_code: expect.objectContaining({ secret: FRESH }),
          }),
        }),
      );
      expect(d.installTelemetryWiring).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "claude", token: FRESH }),
      );
      expect(healed).toEqual({
        endpoint: "https://app.example.com/api/otel/v1/logs",
        headers: { Authorization: `Bearer ${FRESH}` },
      });
    });
  });

  describe("given a CLI that is not signed in", () => {
    /** @scenario "A rejected key with no login to mint with stays silent" */
    it("mints nothing", async () => {
      const d = deps({ loadConfig: () => config({ access_token: undefined }) });

      const healed = await healRevokedIngestKey({
        agent: "claude_code",
        rejectedToken: CACHED,
        deps: d,
      });

      expect(healed).toBeNull();
      expect(d.resolveLiveIngestionKey).not.toHaveBeenCalled();
    });
  });

  describe("given a tool pinned to a project", () => {
    /** @scenario "A tool pinned to a project is not re-minted on the personal path" */
    it("leaves the personal path alone", async () => {
      const d = deps({
        loadConfig: () =>
          config({
            tool_project_keys: {
              claude: { secret: "ik-lw-project-key", project_id: "proj_1" },
            },
          } as Partial<GovernanceConfig>),
      });

      const healed = await healRevokedIngestKey({
        agent: "claude_code",
        rejectedToken: "ik-lw-project-key",
        deps: d,
      });

      expect(healed).toBeNull();
      expect(d.resolveLiveIngestionKey).not.toHaveBeenCalled();
    });
  });

  describe("given a rejected token that is not the cached personal key", () => {
    /** @scenario "A pasted credential is never replaced" */
    it("mints nothing", async () => {
      const d = deps();

      const healed = await healRevokedIngestKey({
        agent: "claude_code",
        rejectedToken: "sk-lw-pasted-by-the-user",
        deps: d,
      });

      expect(healed).toBeNull();
      expect(d.resolveLiveIngestionKey).not.toHaveBeenCalled();
      expect(d.installTelemetryWiring).not.toHaveBeenCalled();
    });
  });

  describe("given a platform that still lists the cached key as live", () => {
    /** @scenario "A key the platform still lists as live is not re-minted" */
    it("returns nothing, because the 401 means something else", async () => {
      const d = deps({
        resolveLiveIngestionKey: vi.fn().mockResolvedValue({
          token: CACHED,
          prefix: CACHED.slice(0, 12),
          endpoint: "https://app.example.com/api/otel",
          minted: false,
        }),
      });

      const healed = await healRevokedIngestKey({
        agent: "claude_code",
        rejectedToken: CACHED,
        deps: d,
      });

      expect(healed).toBeNull();
      expect(d.saveConfig).not.toHaveBeenCalled();
      expect(d.installTelemetryWiring).not.toHaveBeenCalled();
    });
  });

  describe("given a 401 the device carried no key with", () => {
    /** @scenario "A 401 the device sent no key with is not this key's failure" */
    it("mints nothing, because the rejection is not this key's", async () => {
      const d = deps();

      const healed = await healRevokedIngestKey({
        agent: "claude_code",
        rejectedToken: undefined,
        deps: d,
      });

      expect(healed).toBeNull();
      expect(d.resolveLiveIngestionKey).not.toHaveBeenCalled();
      expect(d.installTelemetryWiring).not.toHaveBeenCalled();
    });
  });

  describe("given wiring that cannot be written", () => {
    it("reports no target rather than a half-wired tool", async () => {
      const d = deps({
        installTelemetryWiring: vi.fn().mockReturnValue({
          labels: [],
          warnings: [],
          requiredFailures: ["settings.json is not writable"],
        }),
      });

      const healed = await healRevokedIngestKey({
        agent: "claude_code",
        rejectedToken: CACHED,
        deps: d,
      });

      expect(healed).toBeNull();
      expect(d.saveConfig).not.toHaveBeenCalled();
    });
  });

  describe("given wiring that reports no failure but writes no target", () => {
    /** @scenario "Wiring that writes no target leaves the cached key in place" */
    it("leaves the cache on the old key, so the next 401 can heal", async () => {
      const d = deps({
        installTelemetryWiring: vi.fn().mockReturnValue({
          labels: [],
          warnings: ["could not write ~/.claude/settings.json: EACCES"],
          requiredFailures: [],
        }),
      });

      const healed = await healRevokedIngestKey({
        agent: "claude_code",
        rejectedToken: CACHED,
        deps: d,
      });

      expect(healed).toBeNull();
      expect(d.saveConfig).not.toHaveBeenCalled();
    });
  });
});
