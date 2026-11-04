import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

vi.mock("../tunnel/cloudflared-binary", () => ({
  ensureCloudflaredBinary: vi.fn(async () => undefined),
}));
const launchMock = vi.hoisted(() => vi.fn());
vi.mock("../tunnel/cloudflared-process", () => ({
  launchQuickTunnel: launchMock,
}));

import { startQuickTunnel } from "../tunnel/quick-tunnel";

describe("startQuickTunnel", () => {
  describe("when the tunnel process exits before reporting a URL", () => {
    it("rejects with cloudflared's last log lines", async () => {
      const tunnel = Object.assign(new EventEmitter(), {
        stop: vi.fn(),
        recentLog: () => "ERR failed to request quick Tunnel: 429 Too Many Requests",
      });
      launchMock.mockImplementation(() => {
        setImmediate(() => tunnel.emit("exit", 1, null));
        return tunnel;
      });

      await expect(startQuickTunnel({ localUrl: "http://127.0.0.1:4321" })).rejects.toThrow(
        /exited \(code 1\) before reporting a URL[\s\S]*cloudflared said:\nERR failed to request quick Tunnel: 429/,
      );
    });
  });
});
