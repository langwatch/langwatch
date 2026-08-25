/**
 * Credential resolution for Path B: a project pin wins and is used
 * verbatim with no server round trip; a hand-pasted foreign secret in
 * the personal cache is pinned too (never probed, never re-minted);
 * only a personal `ik-lw-` cache entry is liveness-checked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cliApi from "../cli-api";
import type { GovernanceConfig } from "../config";
import {
  resolveIngestionCredential,
  resolveLiveIngestionKey,
} from "../telemetry-refresh";

vi.mock("../cli-api", async () => {
  const actual = await vi.importActual<typeof cliApi>("../cli-api");
  return {
    ...actual,
    listIngestionKeys: vi.fn(),
    mintIngestionKey: vi.fn(),
  };
});

function baseCfg(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return {
    gateway_url: "http://gw.example.com",
    control_plane_url: "http://app.example.com",
    access_token: "tok",
    organization: { id: "o1", slug: "acme" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveLiveIngestionKey", () => {
  describe("when the cached secret is not a personal ik-lw- token", () => {
    /** @scenario "A hand-pinned foreign key is reused verbatim and never overwritten" */
    it("uses it verbatim without probing or minting", async () => {
      // The user placed this secret by hand (a project sk-lw- key). The
      // personal liveness probe can never match it, so probing would
      // always read "revoked" and re-mint over the user's choice.
      const cfg = baseCfg({
        default_personal_ingest_keys: {
          codex: { secret: "sk-lw-hand-pasted-project-key" },
        },
      });

      const out = await resolveLiveIngestionKey({ cfg, sourceType: "codex" });

      expect(out).toEqual({
        token: "sk-lw-hand-pasted-project-key",
        prefix: undefined,
        endpoint: "http://app.example.com/api/otel",
        minted: false,
      });
      expect(cliApi.listIngestionKeys).not.toHaveBeenCalled();
      expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
    });

    it("stays pinned even when the caller disables the offline fallback", async () => {
      // The login-time refresh passes allowOfflineFallback: false; a
      // foreign secret must survive that path too, or every re-login
      // would overwrite the user's explicit choice.
      const cfg = baseCfg({
        default_personal_ingest_keys: {
          claude_code: { secret: "pkey_legacy_project_key" },
        },
      });

      const out = await resolveLiveIngestionKey({
        cfg,
        sourceType: "claude_code",
        allowOfflineFallback: false,
      });

      expect(out.token).toBe("pkey_legacy_project_key");
      expect(out.minted).toBe(false);
      expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
    });
  });
});

describe("resolveIngestionCredential", () => {
  describe("when the tool is pinned to a project", () => {
    /** @scenario "A project-pinned tool sends with the pinned key and no personal mint" */
    it("returns the pinned secret verbatim with no server call", async () => {
      const cfg = baseCfg({
        tool_project_keys: {
          codex: {
            secret: "ik-lw-projlookup000000_secret",
            project_id: "proj_1",
            project_slug: "acme-app",
          },
        },
        // A personal cache entry for the same source type must NOT win.
        default_personal_ingest_keys: {
          codex: { secret: "ik-lw-personal00000000_secret" },
        },
      });

      const out = await resolveIngestionCredential({
        cfg,
        tool: "codex",
        sourceType: "codex",
      });

      expect(out.scope).toBe("project");
      expect(out.token).toBe("ik-lw-projlookup000000_secret");
      expect(out.projectLabel).toBe("acme-app");
      expect(out.minted).toBe(false);
      expect(out.endpoint).toBe("http://app.example.com/api/otel");
      expect(cliApi.listIngestionKeys).not.toHaveBeenCalled();
      expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
    });

    /** @scenario "The pin's endpoint override routes to the self-hosted instance" */
    it("honours the pin's endpoint override", async () => {
      const cfg = baseCfg({
        tool_project_keys: {
          claude: {
            secret: "sk-lw-pasted",
            endpoint: "https://lw.acme.dev",
          },
        },
      });

      const out = await resolveIngestionCredential({
        cfg,
        tool: "claude",
        sourceType: "claude_code",
      });

      expect(out.endpoint).toBe("https://lw.acme.dev/api/otel");
      expect(out.token).toBe("sk-lw-pasted");
    });

    it("falls back to the project id as the label when no slug is stored", async () => {
      const cfg = baseCfg({
        tool_project_keys: {
          codex: { secret: "sk-lw-x", project_id: "proj_9" },
        },
      });

      const out = await resolveIngestionCredential({
        cfg,
        tool: "codex",
        sourceType: "codex",
      });

      expect(out.projectLabel).toBe("proj_9");
    });
  });

  describe("when the tool has no pin", () => {
    it("resolves the personal path and says so", async () => {
      (cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
        token: "ik-lw-fresh00000000000_secret",
        prefix: "ik-lw-fres",
        endpoint: "http://app.example.com/api/otel",
      });

      const out = await resolveIngestionCredential({
        cfg: baseCfg(),
        tool: "codex",
        sourceType: "codex",
      });

      expect(out.scope).toBe("personal");
      expect(out.minted).toBe(true);
      expect(out.projectLabel).toBeUndefined();
      expect(out.token).toBe("ik-lw-fresh00000000000_secret");
    });
  });
});
