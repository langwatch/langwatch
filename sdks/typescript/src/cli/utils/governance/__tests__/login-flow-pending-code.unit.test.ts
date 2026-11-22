/**
 * A login an agent's command timeout or a closed terminal stopped before the approval: the next
 * run waits on the same code instead of sending the person a new link.
 * Feature: specs/ai-gateway/governance/cli-login.feature
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as configModule from "../config";
import { DeviceFlowError } from "../device-flow";
import type * as deviceFlow from "../device-flow";

const startDeviceCode = vi.fn();
const pollUntilDone = vi.fn();

vi.mock("../device-flow", async () => {
  const actual = await vi.importActual<typeof deviceFlow>("../device-flow");
  return {
    ...actual,
    startDeviceCode: (...args: unknown[]) => startDeviceCode(...args),
    pollUntilDone: (...args: unknown[]) => pollUntilDone(...args),
  };
});

const controlPlane = { url: "https://langwatch.acme.test" };
vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof configModule>("../config");
  return {
    ...actual,
    loadConfig: vi.fn(() => ({
      control_plane_url: controlPlane.url,
      gateway_url: "https://gateway.acme.test",
    })),
    saveConfig: vi.fn(),
    assertConfigWritable: vi.fn(),
  };
});

vi.mock("../cli-api", () => ({
  getCliBootstrap: vi.fn(async () => null),
  getBudgetOverview: vi.fn(async () => null),
  listIngestionKeys: vi.fn(async () => []),
  extractLookupIdFromToken: vi.fn(() => undefined),
}));

vi.mock("../telemetry-refresh", () => ({
  refreshTelemetryWiringForLogin: vi.fn(async () => ({ mintedAny: false, labels: [] })),
  keptWiringLines: () => [],
}));

vi.mock("../../spinner", () => ({
  createSpinner: vi.fn(() => {
    const spinner = {
      start: () => spinner,
      succeed: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn(),
    };
    return spinner;
  }),
}));

vi.mock("../../identityNotice", () => ({ rememberProjectName: vi.fn() }));

import { runDeviceFlowLogin, runUnifiedLoginFlow } from "../login-flow";
import { pendingLoginPath } from "../pending-login";

const signedIn = {
  kind: "device_session" as const,
  access_token: "lw_at_new",
  refresh_token: "lw_rt_new",
  expires_in: 3600,
  user: { id: "u1", email: "dev@acme.test", name: "Dev" },
  organization: { id: "o1", name: "ACME", slug: "acme" },
};

function deviceCode(code: string) {
  return {
    device_code: `dc-${code}`,
    user_code: code,
    verification_uri: `${controlPlane.url}/cli/auth`,
    expires_in: 900,
    interval: 5,
  };
}

/** A login the agent's command timeout killed while it waited on the approval. */
function killedWhileWaiting() {
  return Promise.reject(new Error("the process was killed"));
}

describe("a login waiting on a device code", () => {
  let printed: string[];
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-pending-login-"));
    process.env.LANGWATCH_CLI_CONFIG = path.join(dir, "config.json");
    process.env.LANGWATCH_BROWSER = "none";
    controlPlane.url = "https://langwatch.acme.test";
    printed = [];
    vi.spyOn(console, "log").mockImplementation((...line: unknown[]) => {
      printed.push(line.join(" "));
    });
    startDeviceCode.mockReset();
    pollUntilDone.mockReset();
  });

  afterEach(() => {
    delete process.env.LANGWATCH_CLI_CONFIG;
    delete process.env.LANGWATCH_BROWSER;
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("when the server answers a 15 minute code", () => {
    /** @scenario The CLI says how long the code lives */
    it("tells the reader the code expires in 15 minutes and that a rerun waits on it", async () => {
      startDeviceCode.mockResolvedValueOnce(deviceCode("WDJB-MJHT"));
      pollUntilDone.mockResolvedValueOnce(signedIn);

      await runDeviceFlowLogin();

      const text = printed.join("\n");
      expect(text).toContain("The code expires in 15 minutes.");
      expect(text).toContain("run it again: it waits on the same code");
    });
  });

  describe("when the login stopped before the person approved", () => {
    /** @scenario A login that stops before the approval is picked up by the next run */
    it("waits on the earlier code on the next run and signs in with its approval", async () => {
      startDeviceCode.mockResolvedValueOnce(deviceCode("FRST-CODE"));
      pollUntilDone.mockImplementationOnce(killedWhileWaiting);
      await expect(runDeviceFlowLogin()).rejects.toThrow("killed");

      pollUntilDone.mockResolvedValueOnce(signedIn);
      await runDeviceFlowLogin();

      expect(startDeviceCode).toHaveBeenCalledTimes(1);
      expect(pollUntilDone.mock.calls[1]?.[1]).toMatchObject({ device_code: "dc-FRST-CODE" });
      expect(printed.join("\n")).toContain("user_code=FRST-CODE");
      expect(fs.existsSync(pendingLoginPath())).toBe(false);
    });
  });

  describe("when the rerun comes in the code's last seconds", () => {
    /** @scenario A code in its last seconds is still picked up */
    it("waits on the earlier code rather than starting a new one", async () => {
      startDeviceCode.mockResolvedValueOnce(deviceCode("FRST-CODE"));
      pollUntilDone.mockImplementationOnce(killedWhileWaiting);
      await expect(runDeviceFlowLogin()).rejects.toThrow("killed");

      const saved = JSON.parse(fs.readFileSync(pendingLoginPath(), "utf8")) as {
        expires_at: number;
      };
      vi.spyOn(Date, "now").mockReturnValue(saved.expires_at - 30_000);
      pollUntilDone.mockResolvedValueOnce(signedIn);
      await runDeviceFlowLogin();

      expect(startDeviceCode).toHaveBeenCalledTimes(1);
      expect(pollUntilDone.mock.calls[1]?.[1]).toMatchObject({
        device_code: "dc-FRST-CODE",
        expires_in: 30,
      });
    });
  });

  describe("when another login saved its code while this one waited", () => {
    /** @scenario A finished login leaves another login's code alone */
    it("keeps the other login's code when this one finishes", async () => {
      let finish: ((value: typeof signedIn) => void) | undefined;
      startDeviceCode
        .mockResolvedValueOnce(deviceCode("FRST-CODE"))
        .mockResolvedValueOnce(deviceCode("SCND-CODE"));
      pollUntilDone
        .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
        .mockImplementationOnce(killedWhileWaiting);

      const first = runDeviceFlowLogin();
      await vi.waitFor(() => expect(pollUntilDone).toHaveBeenCalledTimes(1));
      controlPlane.url = "https://langwatch.other.test";
      await expect(runDeviceFlowLogin()).rejects.toThrow("killed");
      finish?.(signedIn);
      await first;

      const pending = JSON.parse(fs.readFileSync(pendingLoginPath(), "utf8")) as {
        device_code: string;
      };
      expect(pending.device_code).toBe("dc-SCND-CODE");
    });
  });

  describe("when the next login asks for something else", () => {
    /** @scenario A login for something else starts its own code */
    it("starts a new code for another control plane or another credential type", async () => {
      startDeviceCode
        .mockResolvedValueOnce(deviceCode("FRST-CODE"))
        .mockResolvedValueOnce(deviceCode("SCND-CODE"))
        .mockResolvedValueOnce(deviceCode("THRD-CODE"));
      pollUntilDone.mockImplementation(killedWhileWaiting);
      await expect(runDeviceFlowLogin()).rejects.toThrow("killed");

      controlPlane.url = "https://langwatch.other.test";
      await expect(runDeviceFlowLogin()).rejects.toThrow("killed");
      await expect(runUnifiedLoginFlow({ kind: "project_api_key" })).rejects.toThrow("killed");

      expect(startDeviceCode).toHaveBeenCalledTimes(3);
    });
  });

  describe("when the picked up code lapsed on the server", () => {
    /** @scenario A picked up code that lapsed starts a fresh one */
    it("asks for a new code and prints it", async () => {
      startDeviceCode
        .mockResolvedValueOnce(deviceCode("FRST-CODE"))
        .mockResolvedValueOnce(deviceCode("SCND-CODE"));
      pollUntilDone.mockImplementationOnce(killedWhileWaiting);
      await expect(runDeviceFlowLogin()).rejects.toThrow("killed");

      pollUntilDone
        .mockRejectedValueOnce(new DeviceFlowError("expired", "authorization request expired"))
        .mockResolvedValueOnce(signedIn);
      await runDeviceFlowLogin();

      expect(startDeviceCode).toHaveBeenCalledTimes(2);
      expect(pollUntilDone.mock.calls[2]?.[1]).toMatchObject({ device_code: "dc-SCND-CODE" });
      expect(printed.join("\n")).toContain("user_code=SCND-CODE");
    });
  });

  describe("when the person denies the code", () => {
    /** @scenario A denied or finished login forgets its code */
    it("forgets it, so the next run asks for a new one", async () => {
      startDeviceCode
        .mockResolvedValueOnce(deviceCode("FRST-CODE"))
        .mockResolvedValueOnce(deviceCode("SCND-CODE"));
      pollUntilDone
        .mockRejectedValueOnce(new DeviceFlowError("denied", "authorization denied"))
        .mockResolvedValueOnce(signedIn);

      await expect(runDeviceFlowLogin()).rejects.toThrow("authorization denied");
      expect(fs.existsSync(pendingLoginPath())).toBe(false);

      await runDeviceFlowLogin();
      expect(startDeviceCode).toHaveBeenCalledTimes(2);
      expect(fs.existsSync(pendingLoginPath())).toBe(false);
    });
  });
});
