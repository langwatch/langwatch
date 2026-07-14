/**
 * Unit tests for the `langwatch copilot-app connect` orchestrator
 * (ADR-039 §Extension) with every collaborator injected — asserts the
 * guards, the mint-after-detect ordering, the agent install, and the
 * tokens-only opt-out notice, without touching the machine or network.
 */

import { describe, expect, it, vi } from "vitest";

import {
  connectCopilotApp,
  CopilotAppConnectError,
  type ConnectCopilotAppDeps,
} from "../copilot-app";
import { type LaunchAgentSpec } from "@/cli/utils/governance/copilot-app";
import { type GovernanceConfig } from "@/cli/utils/governance/config";

const AGENT_PATH =
  "/Users/dev/Library/LaunchAgents/ai.langwatch.copilot-app.plist";

const loggedInCfg = {
  gateway_url: "https://gateway.langwatch.ai",
  control_plane_url: "https://app.langwatch.ai",
  access_token: "lw_at_live",
  organization: { slug: "acme" },
} as unknown as GovernanceConfig;

function baseDeps(
  over: Partial<ConnectCopilotAppDeps> = {},
): ConnectCopilotAppDeps {
  return {
    platform: "darwin",
    home: "/Users/dev",
    env: {},
    exists: () => true,
    loadConfig: () => loggedInCfg,
    mint: vi.fn(async () => ({
      token: "ik-lw-abc_secret",
      endpoint: "https://app.langwatch.ai/api/otel",
    })),
    install: vi.fn((_spec: LaunchAgentSpec) => AGENT_PATH),
    captureContent: true,
    info: vi.fn(),
    warn: vi.fn(),
    ...over,
  };
}

describe("connectCopilotApp", () => {
  describe("when the app is installed and the user is logged in", () => {
    /** @scenario Connecting the app mints a personal ingest key for sourceType copilot_app */
    it("mints a copilot_app ingest key", async () => {
      const mint = vi.fn(async () => ({
        token: "ik-lw-abc_secret",
        endpoint: "https://app.langwatch.ai/api/otel",
      }));

      await connectCopilotApp(baseDeps({ mint }));

      expect(mint).toHaveBeenCalledWith(loggedInCfg, "copilot_app");
    });

    /** @scenario Connecting installs a login agent for the current operating system */
    it("installs the login agent pointed at the app with the minted key", async () => {
      const install = vi.fn((_spec: LaunchAgentSpec) => AGENT_PATH);

      await connectCopilotApp(baseDeps({ install }));

      const spec = install.mock.calls[0]![0];
      expect(spec.execPath).toContain("GitHub Copilot.app");
      expect(spec.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(
        "Authorization=Bearer ik-lw-abc_secret",
      );
    });

    /** @scenario Connect confirms where the captured traces will appear */
    it("confirms the project the app's usage is tracked into", async () => {
      const info = vi.fn();

      await connectCopilotApp(baseDeps({ info }));

      expect(info).toHaveBeenCalledWith(expect.stringContaining("acme"));
    });
  });

  describe("when the user opts out of content capture", () => {
    /** @scenario An explicit opt-out yields a loud tokens-only notice, never silent */
    it("loudly notifies that capture is tokens-only", async () => {
      const warn = vi.fn();

      const result = await connectCopilotApp(
        baseDeps({ captureContent: false, warn }),
      );

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("tokens only"));
      expect(result.captureContent).toBe(false);
    });
  });

  describe("when the app is not installed", () => {
    /** @scenario Connect refuses when the app is not installed */
    it("fails loudly and never mints a key", async () => {
      const mint = vi.fn();

      await expect(
        connectCopilotApp(baseDeps({ exists: () => false, mint })),
      ).rejects.toMatchObject({ kind: "not-installed" });
      expect(mint).not.toHaveBeenCalled();
    });
  });

  describe("when the user is not logged in", () => {
    it("refuses before doing anything", async () => {
      const mint = vi.fn();

      await expect(
        connectCopilotApp(
          baseDeps({
            loadConfig: () => ({}) as GovernanceConfig,
            mint,
          }),
        ),
      ).rejects.toBeInstanceOf(CopilotAppConnectError);
      expect(mint).not.toHaveBeenCalled();
    });
  });
});
