import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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
  isLoggedIn: (cfg: { access_token?: string } | undefined) =>
    !!cfg?.access_token,
}));

// The slug path's server boundary: POST /api/auth/cli/project-key.
const fetchProjectKeyBySlug = vi.fn();
vi.mock("@/cli/utils/governance/session-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/cli/utils/governance/session-api")
  >("@/cli/utils/governance/session-api");
  return {
    SessionApiError: actual.SessionApiError,
    fetchPersonalProject: vi.fn(),
    fetchProjectKeyBySlug: (...args: unknown[]) =>
      fetchProjectKeyBySlug(...args),
  };
});

// Keep the notice's name-cache seeding away from the real filesystem.
vi.mock("@/cli/utils/identityNotice", () => ({
  rememberProjectName: vi.fn(),
  maybePrintIdentityNotice: vi.fn(async () => undefined),
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
      /** @scenario `langwatch login` (no flags, NON-TTY) defaults to project login, never AI-tools */
      it("keeps the project-login default but fails fast instead of polling a browser", async () => {
        await expect(loginCommand({})).rejects.toThrow("process.exit(1)");

        // Fail fast means NEITHER flow starts: no device session, and no
        // browser device-code poll that would block a headless caller.
        expect(runUnifiedLoginFlow).not.toHaveBeenCalled();
        expect(runDeviceFlowLogin).not.toHaveBeenCalled();
      });

      it("prints the project-login default and names both escape hatches", async () => {
        const logSpy = console.log as unknown as ReturnType<typeof vi.fn>;
        await expect(loginCommand({})).rejects.toThrow("process.exit(1)");

        const printed = logSpy.mock.calls.flat().join("\n");
        expect(printed).toContain("project login");
        expect(printed).toContain("--device");
        expect(printed).toContain("--project");
      });
    });
  });

  describe("given the --project flag in a non-TTY context", () => {
    beforeEach(() => setTTY(false));

    /** @scenario headless `langwatch login --project` fails fast instead of waiting on a browser */
    it("fails fast with every non-interactive path forward, never starting the poll", async () => {
      const errorSpy = console.error as unknown as ReturnType<typeof vi.fn>;

      await expect(loginCommand({ project: true })).rejects.toThrow(
        "process.exit(1)",
      );

      expect(runUnifiedLoginFlow).not.toHaveBeenCalled();
      const printed = errorSpy.mock.calls.flat().join("\n");
      expect(printed).toContain("langwatch login --project <slug>");
      expect(printed).toContain("langwatch login --api-key <key>");
      expect(printed).toContain("LANGWATCH_API_KEY");
    });
  });

  describe("given a --project <slug> value", () => {
    describe("when a device session exists", () => {
      beforeEach(() => {
        setTTY(false);
        loadConfig.mockReturnValue({
          control_plane_url: "https://app.langwatch.ai",
          access_token: "lw_at_x",
        } as never);
        fetchProjectKeyBySlug.mockResolvedValue({
          api_key: "sk-lw-project",
          project: { id: "p1", slug: "checkout", name: "Checkout" },
        });
      });

      /** @scenario `langwatch login --project <slug>` resolves the key through the device session, no browser */
      it("resolves the key through the session, writes .env, never opens a browser", async () => {
        // The slug path writes LANGWATCH_API_KEY into $CWD/.env; run it in a
        // scratch directory so the repo's own .env is never touched.
        const cwd = process.cwd();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-login-"));
        process.chdir(dir);
        try {
          await loginCommand({ project: "checkout" });

          expect(fetchProjectKeyBySlug).toHaveBeenCalledWith(
            expect.objectContaining({ access_token: "lw_at_x" }),
            "checkout",
          );
          expect(runUnifiedLoginFlow).not.toHaveBeenCalled();
          expect(promptsMock).not.toHaveBeenCalled();
          expect(fs.readFileSync(path.join(dir, ".env"), "utf8")).toContain(
            "LANGWATCH_API_KEY=sk-lw-project",
          );
        } finally {
          process.chdir(cwd);
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });
    });

    describe("when no device session exists", () => {
      /** @scenario `--project <slug>` without a device session fails with actionable guidance */
      it("exits 1 and points at a browser-able login or --api-key", async () => {
        setTTY(false);
        loadConfig.mockReturnValue({
          control_plane_url: "https://app.langwatch.ai",
        });
        const errorSpy = console.error as unknown as ReturnType<typeof vi.fn>;

        await expect(loginCommand({ project: "checkout" })).rejects.toThrow(
          "process.exit(1)",
        );

        expect(fetchProjectKeyBySlug).not.toHaveBeenCalled();
        const printed = errorSpy.mock.calls.flat().join("\n");
        expect(printed).toContain("langwatch login");
        expect(printed).toContain("--api-key");
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
      /** @scenario "picking LangWatch Cloud repoints away from a previously-local endpoint" */
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
