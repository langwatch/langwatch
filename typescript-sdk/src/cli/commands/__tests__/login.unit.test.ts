import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The two login-flow entry points are the seam: project login goes through
// runUnifiedLoginFlow({ kind: "project_api_key" }); AI-tools login goes
// through runDeviceFlowLogin (a device_session). We assert which one the
// command picks per context — no network, no browser.
const runUnifiedLoginFlow = vi.fn().mockResolvedValue({});
const runDeviceFlowLogin = vi.fn().mockResolvedValue({});
vi.mock("@/cli/utils/governance/login-flow", () => ({
  runUnifiedLoginFlow: (...args: unknown[]) => runUnifiedLoginFlow(...args),
  runDeviceFlowLogin: (...args: unknown[]) => runDeviceFlowLogin(...args),
}));

const loadConfig = vi.fn(() => ({
  control_plane_url: "https://app.langwatch.ai",
}));
const saveConfig = vi.fn();
vi.mock("@/cli/utils/governance/config", () => ({
  loadConfig: () => loadConfig(),
  saveConfig: (...args: unknown[]) => saveConfig(...args),
}));

import { loginCommand } from "../login";

describe("loginCommand", () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalEndpoint = process.env.LANGWATCH_ENDPOINT;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    delete process.env.LANGWATCH_ENDPOINT;
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    if (originalEndpoint === undefined) delete process.env.LANGWATCH_ENDPOINT;
    else process.env.LANGWATCH_ENDPOINT = originalEndpoint;
    vi.restoreAllMocks();
  });

  const setTTY = (value: boolean) =>
    Object.defineProperty(process.stdin, "isTTY", {
      value,
      configurable: true,
    });

  describe("given no flags in a non-TTY context", () => {
    beforeEach(() => setTTY(false));

    it("defaults to project login, never the AI-tools device session", async () => {
      await loginCommand({});

      expect(runUnifiedLoginFlow).toHaveBeenCalledTimes(1);
      expect(runUnifiedLoginFlow).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "project_api_key" }),
      );
      expect(runDeviceFlowLogin).not.toHaveBeenCalled();
    });

    it("prints the project-login default and the --device escape hatch", async () => {
      const logSpy = console.log as unknown as ReturnType<typeof vi.fn>;
      await loginCommand({});

      const printed = logSpy.mock.calls.flat().join("\n");
      expect(printed).toContain("project login");
      expect(printed).toContain("--device");
    });
  });

  describe("given the --device flag", () => {
    beforeEach(() => setTTY(false));

    it("runs the AI-tools device session, not project login", async () => {
      await loginCommand({ device: true });

      expect(runDeviceFlowLogin).toHaveBeenCalledTimes(1);
      expect(runUnifiedLoginFlow).not.toHaveBeenCalled();
    });
  });
});
