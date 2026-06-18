import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The two login-flow entry points are the seam: project login goes through
// runUnifiedLoginFlow({ kind: "project_api_key" }); AI-tools login goes
// through runDeviceFlowLogin (a device_session). We assert which one the
// command picks per context, no network, no browser.
const runUnifiedLoginFlow = vi.fn().mockResolvedValue({});
const runDeviceFlowLogin = vi.fn().mockResolvedValue({});
vi.mock("@/cli/utils/governance/login-flow", () => ({
  runUnifiedLoginFlow: (...args: unknown[]) => runUnifiedLoginFlow(...args),
  runDeviceFlowLogin: (...args: unknown[]) => runDeviceFlowLogin(...args),
}));

// `prompts` is the interactive UI boundary. We drive it with queued answers
// per test and inspect the choices it was handed (ordering / labels).
const promptsMock = vi.fn();
vi.mock("prompts", () => ({
  default: (...args: unknown[]) => promptsMock(...args),
}));

// loadConfig is the persisted ~/.langwatch/config.json. We vary
// control_plane_url to simulate a fresh (cloud) install vs an existing local
// endpoint. The real resolveControlPlaneEndpoint reads this mock.
const loadConfig = vi.fn(() => ({
  control_plane_url: "https://app.langwatch.ai",
}));
const saveConfig = vi.fn();
vi.mock("@/cli/utils/governance/config", () => ({
  loadConfig: () => loadConfig(),
  saveConfig: (...args: unknown[]) => saveConfig(...args),
}));

import { loginCommand } from "../login";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

describe("loginCommand", () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalEndpoint = process.env.LANGWATCH_ENDPOINT;

  beforeEach(() => {
    vi.clearAllMocks();
    loadConfig.mockReturnValue({ control_plane_url: "https://app.langwatch.ai" });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
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

    describe("when the command is invoked with no flags", () => {
      it("defaults to project login, never the AI-tools device session", async () => {
        await loginCommand({});

        expect(runUnifiedLoginFlow).toHaveBeenCalledTimes(1);
        expect(runUnifiedLoginFlow).toHaveBeenCalledWith(
          expect.objectContaining({ kind: "project_api_key" }),
        );
        expect(runDeviceFlowLogin).not.toHaveBeenCalled();
      });

      it("prints the project-login default and names both escape hatches", async () => {
        const logSpy = console.log as unknown as ReturnType<typeof vi.fn>;
        await loginCommand({});

        const printed = logSpy.mock.calls.flat().join("\n");
        expect(printed).toContain("project login");
        expect(printed).toContain("--device");
        expect(printed).toContain("--project");
      });
    });
  });

  describe("given the --device flag", () => {
    beforeEach(() => setTTY(false));

    describe("when the command is invoked with --device", () => {
      it("runs the AI-tools device session, not project login", async () => {
        await loginCommand({ device: true });

        expect(runDeviceFlowLogin).toHaveBeenCalledTimes(1);
        expect(runUnifiedLoginFlow).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the --project flag", () => {
    describe("when the command is invoked with --project on a TTY", () => {
      beforeEach(() => setTTY(true));

      it("runs the project API-key flow directly with no prompts", async () => {
        await loginCommand({ project: true });

        expect(runUnifiedLoginFlow).toHaveBeenCalledTimes(1);
        expect(runUnifiedLoginFlow).toHaveBeenCalledWith(
          expect.objectContaining({ kind: "project_api_key" }),
        );
        expect(runDeviceFlowLogin).not.toHaveBeenCalled();
        expect(promptsMock).not.toHaveBeenCalled();
      });
    });
  });

  describe("given an interactive TTY and a fresh (cloud) config", () => {
    beforeEach(() => {
      setTTY(true);
      loadConfig.mockReturnValue({
        control_plane_url: "https://app.langwatch.ai",
      });
    });

    describe("when the user opens the 'Where do you want to log in?' picker", () => {
      it("lists LangWatch Cloud first", async () => {
        promptsMock
          .mockResolvedValueOnce({ where: "cloud" })
          .mockResolvedValueOnce({ mode: "device" });

        await loginCommand({});

        const firstCall = promptsMock.mock.calls[0]![0] as {
          choices: Array<{ value: string }>;
        };
        expect(firstCall.choices.map((c) => c.value)).toEqual([
          "cloud",
          "self-hosted",
        ]);
      });
    });

    describe("when the user selects LangWatch Cloud", () => {
      it("persists app.langwatch.ai", async () => {
        promptsMock
          .mockResolvedValueOnce({ where: "cloud" })
          .mockResolvedValueOnce({ mode: "device" });

        await loginCommand({});

        expect(saveConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            control_plane_url: "https://app.langwatch.ai",
          }),
        );
      });
    });
  });

  describe("given an interactive TTY and an existing local endpoint", () => {
    beforeEach(() => {
      setTTY(true);
      loadConfig.mockReturnValue({
        control_plane_url: "http://localhost:5560",
      });
    });

    describe("when the user opens the picker", () => {
      it("defaults to keeping the current endpoint and lists Cloud last", async () => {
        promptsMock
          .mockResolvedValueOnce({ where: "keep" })
          .mockResolvedValueOnce({ mode: "device" });

        await loginCommand({});

        const call = promptsMock.mock.calls[0]![0] as {
          choices: Array<{ value: string; title: string }>;
          initial?: number;
        };
        expect(call.choices.map((c) => c.value)).toEqual([
          "keep",
          "self-hosted",
          "cloud",
        ]);
        expect(call.choices[0]!.title).toContain("http://localhost:5560");
        expect(call.initial).toBe(0);
      });
    });

    describe("when the user keeps the current endpoint", () => {
      it("persists the local endpoint unchanged", async () => {
        promptsMock
          .mockResolvedValueOnce({ where: "keep" })
          .mockResolvedValueOnce({ mode: "device" });

        await loginCommand({});

        expect(saveConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            control_plane_url: "http://localhost:5560",
          }),
        );
      });
    });

    describe("when the user picks LangWatch Cloud despite the local endpoint", () => {
      it("repoints the persisted endpoint to app.langwatch.ai", async () => {
        promptsMock
          .mockResolvedValueOnce({ where: "cloud" })
          .mockResolvedValueOnce({ mode: "device" });

        await loginCommand({});

        expect(saveConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            control_plane_url: "https://app.langwatch.ai",
          }),
        );
      });
    });

    describe("when the user picks a different self-hosted endpoint", () => {
      it("persists the newly entered URL with trailing slash stripped", async () => {
        promptsMock
          .mockResolvedValueOnce({ where: "self-hosted" })
          .mockResolvedValueOnce({ url: "https://lw.acme.internal/" })
          .mockResolvedValueOnce({ mode: "device" });

        await loginCommand({});

        expect(saveConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            control_plane_url: "https://lw.acme.internal",
          }),
        );
      });
    });
  });
});
