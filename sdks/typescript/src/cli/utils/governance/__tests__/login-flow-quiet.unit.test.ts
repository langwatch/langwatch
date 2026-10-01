/**
 * The device login as a step of another command. `langy --share-control` words the sign-in itself,
 * so the flow prints the address to open, the code and who signed in, and leaves the rest of the
 * ceremony to `langwatch login`. Feature: specs/typescript-sdk/cli-langy-share-control.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as deviceFlow from "../device-flow";

vi.mock("../device-flow", async () => {
  const actual = await vi.importActual<typeof deviceFlow>("../device-flow");
  return {
    ...actual,
    startDeviceCode: vi.fn(async () => ({
      device_code: "dc",
      user_code: "WDJB-MJHT",
      verification_uri: "https://langwatch.acme.test/cli/auth",
      expires_in: 600,
      interval: 5,
    })),
    pollUntilDone: vi.fn(async () => ({
      kind: "device_session" as const,
      access_token: "lw_at_new",
      refresh_token: "lw_rt_new",
      expires_in: 3600,
      user: { id: "u1", email: "dev@acme.test", name: "Dev" },
      organization: { id: "o1", name: "ACME", slug: "acme" },
    })),
  };
});

const getBudgetOverview = vi.fn(async () => null);
vi.mock("../cli-api", () => ({
  getCliBootstrap: vi.fn(async () => ({
    tools: [{ command: "langwatch claude", label: "Claude Code" }],
    providers: [{ name: "bedrock", displayName: "AWS Bedrock", configured: false }],
  })),
  getBudgetOverview: (...args: unknown[]) => getBudgetOverview(...(args as [])),
  listIngestionKeys: vi.fn(async () => []),
  extractLookupIdFromToken: vi.fn(() => undefined),
}));

const refresh = vi.fn(async () => ({ mintedAny: false, labels: [] as string[] }));
vi.mock("../telemetry-refresh", () => ({
  refreshTelemetryWiringForLogin: () => refresh(),
  keptWiringLines: () => [],
}));

const succeed = vi.fn();
vi.mock("../../spinner", () => ({
  createSpinner: vi.fn(() => {
    const spinner = {
      start: () => spinner,
      succeed,
      fail: vi.fn(),
      stop: vi.fn(),
    };
    return spinner;
  }),
}));

vi.mock("../config", () => ({
  loadConfig: vi.fn(() => ({
    control_plane_url: "https://langwatch.acme.test",
    gateway_url: "https://gateway.acme.test",
  })),
  saveConfig: vi.fn(),
  displayConfigPath: () => "~/.langwatch/config.json",
}));

vi.mock("../../identityNotice", () => ({
  rememberProjectName: vi.fn(),
}));

import { runDeviceFlowLogin } from "../login-flow";

describe("the device login", () => {
  let printed: string[];

  beforeEach(() => {
    printed = [];
    process.env.LANGWATCH_BROWSER = "none";
    vi.spyOn(console, "log").mockImplementation((...line: unknown[]) => {
      printed.push(line.join(" "));
    });
    succeed.mockClear();
    refresh.mockClear();
    getBudgetOverview.mockClear();
  });

  afterEach(() => {
    delete process.env.LANGWATCH_BROWSER;
    vi.restoreAllMocks();
  });

  describe("when it runs as a step of another command", () => {
    /** @scenario "The sign-in inside the command prints only what signing in needs" */
    it("prints the address, the code and who signed in, and nothing of the ceremony", async () => {
      await runDeviceFlowLogin({ isQuiet: true });

      const text = printed.join("\n");
      expect(text).toContain("https://langwatch.acme.test/cli/auth?user_code=WDJB-MJHT");
      expect(text).toContain("WDJB-MJHT");
      expect(succeed).toHaveBeenCalledWith("Logged in as dev@acme.test");
      expect(text).not.toContain("LangWatch login");
      expect(text).not.toContain("Control plane:");
      expect(text).not.toContain("Mode:");
      expect(text).not.toContain("Your AI tools");
      expect(text).not.toContain("Model providers");
      expect(text).not.toContain("Dashboard:");
      expect(getBudgetOverview).not.toHaveBeenCalled();
    });

    it("still reports a change to the machine's tool wiring", async () => {
      refresh.mockResolvedValueOnce({
        mintedAny: false,
        labels: ["claude settings"],
      });

      await runDeviceFlowLogin({ isQuiet: true });

      expect(printed.join("\n")).toContain("claude settings");
    });
  });

  describe("when it runs as `langwatch login`", () => {
    it("keeps the whole ceremony", async () => {
      await runDeviceFlowLogin();

      const text = printed.join("\n");
      expect(text).toContain("LangWatch login");
      expect(text).toContain("Your AI tools");
      expect(text).toContain("Model providers");
      expect(text).toContain("Dashboard:");
    });
  });
});
