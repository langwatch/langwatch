/**
 * Unit tests for the GitHub Copilot app capture core (ADR-039
 * §Extension): the OTLP env block the login agent injects, app-executable
 * detection per platform, and the per-OS login-agent descriptors. All
 * pure — no disk, no OS registration (that lives in the imperative
 * installer, tested separately).
 */

import { describe, expect, it } from "vitest";

import {
  buildCopilotAppEnv,
  copilotAppCandidatePaths,
  findCopilotApp,
  renderLaunchAgent,
  COPILOT_APP_AGENT_LABEL,
} from "../copilot-app";

describe("buildCopilotAppEnv", () => {
  describe("when content capture is enabled", () => {
    /** @scenario The app process is pointed at the LangWatch OTLP endpoint */
    it("points the app at the LangWatch OTLP endpoint and enables copilot OTel", () => {
      const env = buildCopilotAppEnv({
        endpoint: "https://app.langwatch.ai/api/otel",
        token: "ik-lw-abc_secret",
        captureContent: true,
      });

      expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
        "https://app.langwatch.ai/api/otel",
      );
      expect(env.COPILOT_OTEL_ENABLED).toBe("true");
    });

    /** @scenario The app process carries the ingest key as a bearer auth header */
    it("carries the ingest key as a bearer auth header", () => {
      const env = buildCopilotAppEnv({
        endpoint: "https://app.langwatch.ai/api/otel",
        token: "ik-lw-abc_secret",
        captureContent: true,
      });

      expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBe(
        "Authorization=Bearer ik-lw-abc_secret",
      );
    });

    /** @scenario Content capture is enabled by default */
    it("enables message-content capture", () => {
      const env = buildCopilotAppEnv({
        endpoint: "https://app.langwatch.ai/api/otel",
        token: "ik-lw-abc_secret",
        captureContent: true,
      });

      expect(env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT).toBe("true");
    });

    it("labels the surface copilot-app to distinguish it from the CLI", () => {
      const env = buildCopilotAppEnv({
        endpoint: "https://app.langwatch.ai/api/otel",
        token: "ik-lw-abc_secret",
        captureContent: true,
      });

      expect(env.OTEL_RESOURCE_ATTRIBUTES).toBe("service.name=copilot-app");
    });
  });

  describe("when the user opts out of content capture", () => {
    /** @scenario An explicit opt-out yields a loud tokens-only notice, never silent */
    it("drops the content-capture flag so the app emits tokens only", () => {
      const env = buildCopilotAppEnv({
        endpoint: "https://app.langwatch.ai/api/otel",
        token: "ik-lw-abc_secret",
        captureContent: false,
      });

      expect(
        env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT,
      ).toBeUndefined();
      // still exports — only content is withheld
      expect(env.COPILOT_OTEL_ENABLED).toBe("true");
    });
  });
});

describe("findCopilotApp", () => {
  describe("when the app is installed", () => {
    it("resolves the macOS app executable", () => {
      const found = findCopilotApp(
        "darwin",
        "/Users/dev",
        (p) => p === "/Applications/GitHub Copilot.app/Contents/MacOS/github",
      );

      expect(found).toBe(
        "/Applications/GitHub Copilot.app/Contents/MacOS/github",
      );
    });
  });

  describe("when the app is not installed", () => {
    /** @scenario Connect refuses when the app is not installed */
    it("returns null when no candidate executable exists", () => {
      const found = findCopilotApp("darwin", "/Users/dev", () => false);

      expect(found).toBeNull();
    });
  });

  it("offers Windows candidates under LOCALAPPDATA and Program Files", () => {
    const paths = copilotAppCandidatePaths("win32", "C:\\Users\\dev", {
      LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
    });

    expect(paths.some((p) => p.includes("AppData\\Local"))).toBe(true);
    expect(paths.some((p) => p.includes("Program Files"))).toBe(true);
  });
});

describe("renderLaunchAgent", () => {
  const env = {
    COPILOT_OTEL_ENABLED: "true",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://app.langwatch.ai/api/otel",
    OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer ik-lw-abc_secret",
  };

  describe("when the platform is macOS", () => {
    /** @scenario On macOS the agent is a launchd login item */
    it("renders a launchd plist under ~/Library/LaunchAgents that launches the app with the env at login", () => {
      const d = renderLaunchAgent({
        platform: "darwin",
        home: "/Users/dev",
        execPath: "/Applications/GitHub Copilot.app/Contents/MacOS/github",
        env,
      });

      expect(d.path).toBe(
        `/Users/dev/Library/LaunchAgents/${COPILOT_APP_AGENT_LABEL}.plist`,
      );
      expect(d.content).toContain("<key>RunAtLoad</key>");
      expect(d.content).toContain(
        "/Applications/GitHub Copilot.app/Contents/MacOS/github",
      );
      expect(d.content).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
      expect(d.content).toContain("Authorization=Bearer ik-lw-abc_secret");
    });
  });

  describe("when the platform is Linux", () => {
    /** @scenario On Linux the agent is a systemd --user unit */
    it("renders a systemd --user unit with Environment= lines and ExecStart", () => {
      const d = renderLaunchAgent({
        platform: "linux",
        home: "/home/dev",
        execPath: "/opt/GitHub Copilot/github-copilot",
        env,
      });

      expect(d.path).toBe(
        `/home/dev/.config/systemd/user/${COPILOT_APP_AGENT_LABEL}.service`,
      );
      expect(d.content).toContain("WantedBy=default.target");
      expect(d.content).toContain(
        'Environment="OTEL_EXPORTER_OTLP_ENDPOINT=https://app.langwatch.ai/api/otel"',
      );
      expect(d.content).toContain("ExecStart=/opt/GitHub Copilot/github-copilot");
    });
  });

  describe("when the platform is Windows", () => {
    /** @scenario On Windows the agent is a Task Scheduler logon task */
    it("renders a Task Scheduler logon task XML carrying the env", () => {
      const d = renderLaunchAgent({
        platform: "win32",
        home: "C:\\Users\\dev",
        execPath: "C:\\Users\\dev\\AppData\\Local\\Programs\\GitHub Copilot\\GitHub Copilot.exe",
        env,
      });

      expect(d.path).toContain(`${COPILOT_APP_AGENT_LABEL}.xml`);
      expect(d.content).toContain("<LogonTrigger>");
      expect(d.content).toContain("<Name>OTEL_EXPORTER_OTLP_ENDPOINT</Name>");
      expect(d.content).toContain("GitHub Copilot.exe");
    });
  });
});
