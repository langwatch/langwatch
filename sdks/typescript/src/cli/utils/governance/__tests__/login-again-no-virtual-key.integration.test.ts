/**
 * `langwatch login` run a second time against a real HTTP control plane: the device flow and the
 * CLI's own client are real, only the machine's tool wiring is stubbed. Feature:
 * specs/ai-gateway/governance/cli-login.feature
 */
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../telemetry-refresh", () => ({
  refreshTelemetryWiringForLogin: async () => ({ mintedAny: false, labels: [] as string[] }),
  keptWiringLines: () => [],
}));

import { runDeviceFlowLogin } from "../login-flow";

interface Seen {
  method: string;
  path: string;
}

const approvedSession = {
  kind: "device_session",
  access_token: "lw_at_second_login",
  refresh_token: "lw_rt_second_login",
  expires_in: 3600,
  user: { id: "u1", email: "jane@acme.com", name: "Jane" },
  organization: { id: "o1", name: "Acme", slug: "acme" },
};

describe("logging in again on a machine that has logged in before", () => {
  let server: http.Server;
  let seen: Seen[];
  let dir: string;
  let configFile: string;
  let endpoint: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push({ method: req.method ?? "", path: (req.url ?? "").split("?")[0]! });
      req.resume();
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/auth/cli/device-code") {
        res.end(
          JSON.stringify({
            device_code: "dc-again",
            user_code: "WDJB-MJHT",
            verification_uri: `${endpoint}/cli/auth`,
            expires_in: 600,
            interval: 1,
          }),
        );
        return;
      }
      if (req.url === "/api/auth/cli/exchange") {
        res.end(JSON.stringify(approvedSession));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    seen = [];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-login-again-"));
    configFile = path.join(dir, "config.json");
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        control_plane_url: endpoint,
        gateway_url: "http://localhost:5563",
        access_token: "lw_at_first_login",
        refresh_token: "lw_rt_first_login",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: approvedSession.user,
        organization: approvedSession.organization,
        default_personal_vk: { id: "vk_jane", secret: "vk_secret", prefix: "vk_jane" },
      }),
    );
    process.env.LANGWATCH_CLI_CONFIG = configFile;
    process.env.LANGWATCH_BROWSER = "none";
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.LANGWATCH_CLI_CONFIG;
    delete process.env.LANGWATCH_BROWSER;
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** @scenario "Logging in again creates no virtual keys" */
  it("approves the device without ever asking the control plane to issue a virtual key", async () => {
    await runDeviceFlowLogin();

    const saved = JSON.parse(fs.readFileSync(configFile, "utf8"));
    expect(saved.access_token).toBe("lw_at_second_login");
    expect(seen).toContainEqual({ method: "POST", path: "/api/auth/cli/exchange" });
    const issued = seen.filter((request) => request.path === "/api/auth/cli/virtual-key");
    expect(issued).toEqual([]);
    const creating = seen.filter((request) => request.method === "POST").map((r) => r.path);
    expect(creating).toEqual(["/api/auth/cli/device-code", "/api/auth/cli/exchange"]);
  });
});
