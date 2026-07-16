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
    it("renders a launchd plist that launches the app with the env at login", () => {
      const d = renderLaunchAgent({
        platform: "darwin",
        home: "/Users/dev",
        execPath: "/Applications/GitHub Copilot.app/Contents/MacOS/github",
        env,
      });

      expect(d.registerPath).toBe(
        `/Users/dev/Library/LaunchAgents/${COPILOT_APP_AGENT_LABEL}.plist`,
      );
      const plist = d.files[0]!;
      expect(plist.path).toBe(d.registerPath);
      expect(plist.content).toContain("<key>RunAtLoad</key>");
      expect(plist.content).toContain(
        "/Applications/GitHub Copilot.app/Contents/MacOS/github",
      );
      expect(plist.content).toContain("Authorization=Bearer ik-lw-abc_secret");
    });

    it("writes the token-bearing plist with owner-only (0600) permissions", () => {
      const d = renderLaunchAgent({
        platform: "darwin",
        home: "/Users/dev",
        execPath: "/Applications/GitHub Copilot.app/Contents/MacOS/github",
        env,
      });

      expect(d.files[0]!.mode).toBe(0o600);
    });
  });

  describe("when the platform is Linux", () => {
    /** @scenario On Linux the agent is a systemd --user unit */
    it("quotes ExecStart so an app path with spaces is not word-split", () => {
      const d = renderLaunchAgent({
        platform: "linux",
        home: "/home/dev",
        execPath: "/opt/GitHub Copilot/github-copilot",
        env,
      });

      expect(d.registerPath).toBe(
        `/home/dev/.config/systemd/user/${COPILOT_APP_AGENT_LABEL}.service`,
      );
      const unit = d.files[0]!.content;
      expect(unit).toContain(
        'Environment="OTEL_EXPORTER_OTLP_ENDPOINT=https://app.langwatch.ai/api/otel"',
      );
      // the fix: quoted, so systemd treats the spaced path as one token
      expect(unit).toContain('ExecStart="/opt/GitHub Copilot/github-copilot"');
      expect(unit).not.toContain(
        "ExecStart=/opt/GitHub Copilot/github-copilot",
      );
    });
  });

  describe("when the platform is Windows", () => {
    const winSpec = {
      platform: "win32" as const,
      home: "C:\\Users\\dev",
      execPath:
        "C:\\Users\\dev\\AppData\\Local\\Programs\\GitHub Copilot\\GitHub Copilot.exe",
      env,
    };

    /** @scenario On Windows the agent is a Task Scheduler logon task */
    it("registers a logon task whose XML carries NO invalid <Environment> element", () => {
      const d = renderLaunchAgent(winSpec);

      const xml = d.files.find((f) => f.path === d.registerPath)!.content;
      expect(d.registerPath).toContain(`${COPILOT_APP_AGENT_LABEL}.xml`);
      expect(xml).toContain("<LogonTrigger>");
      // <Environment> is NOT a valid Task Scheduler element — must be absent
      expect(xml).not.toContain("<Environment>");
      // the declaration must match the UTF-8 bytes writeFile emits, or
      // schtasks /Create /XML rejects it as malformed
      expect(xml).toContain('encoding="UTF-8"');
      expect(xml).not.toContain("UTF-16");
    });

    it("sets the env via a wrapper script the task launches, not the XML", () => {
      const d = renderLaunchAgent(winSpec);

      const xml = d.files.find((f) => f.path === d.registerPath)!.content;
      const wrapper = d.files.find((f) => f.path.endsWith(".cmd"))!;

      // the task command points at the wrapper
      expect(xml).toContain(`${COPILOT_APP_AGENT_LABEL}.cmd`);
      // the wrapper sets each var then starts the app
      expect(wrapper.content).toContain(
        'set "OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer ik-lw-abc_secret"',
      );
      expect(wrapper.content).toContain('start "" "');
      expect(wrapper.content).toContain("GitHub Copilot.exe");
      // token lives only in the wrapper, not the registered XML
      expect(xml).not.toContain("ik-lw-abc_secret");
      expect(wrapper.mode).toBe(0o600);
    });
  });
});
