import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { launchQuickTunnel, type TunnelHandle } from "../tunnel/cloudflared-process";

const TUNNEL_URL = "https://lively-otter.trycloudflare.com";

/**
 * A stand-in cloudflared: records its arguments, logs a failed request to the
 * quick-tunnel service (api.trycloudflare.com, never the tunnel), then the URL
 * split across two writes the way a chunked pipe can deliver it.
 */
function writeFakeCloudflared(dir: string): string {
  const binPath = path.join(dir, "cloudflared");
  fs.writeFileSync(
    binPath,
    `#!/bin/sh
printf '%s\\n' "$@" > "${dir}/args"
printf 'ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel"\\n' >&2
printf 'INF |  https://lively-ot' >&2
sleep 0.05
printf 'ter.trycloudflare.com  |\\n' >&2
exec sleep 30
`,
    { mode: 0o755 },
  );
  return binPath;
}

describe.skipIf(process.platform === "win32")("launchQuickTunnel", () => {
  let dir: string;
  const started: TunnelHandle[] = [];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-cloudflared-process-"));
  });

  afterEach(() => {
    // A failed assertion must not leave a fake tunnel running.
    for (const tunnel of started.splice(0)) tunnel.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("when the tunnel logs its public URL", () => {
    /** @scenario "The tunnel process never updates itself mid-session" */
    it("reports the URL and starts the tunnel with automatic updates off", async () => {
      const tunnel = launchQuickTunnel({
        binPath: writeFakeCloudflared(dir),
        localUrl: "http://127.0.0.1:4321",
      });
      started.push(tunnel);

      const url = await new Promise<string>((resolve) => tunnel.once("url", resolve));
      const exited = new Promise<unknown>((resolve) =>
        tunnel.once("exit", (_code, signal) => resolve(signal)),
      );
      tunnel.stop();

      expect(url).toBe(TUNNEL_URL);
      expect(fs.readFileSync(path.join(dir, "args"), "utf8").split("\n")).toEqual([
        "tunnel",
        "--no-autoupdate",
        "--url",
        "http://127.0.0.1:4321",
        "",
      ]);
      await expect(exited).resolves.toBe("SIGINT");
    });
  });

  describe("when cloudflared exits before reporting a URL", () => {
    it("keeps its last log lines for the error", async () => {
      const binPath = path.join(dir, "cloudflared");
      fs.writeFileSync(
        binPath,
        `#!/bin/sh
printf 'ERR failed to request quick Tunnel: 429 Too Many Requests\\n' >&2
exit 1
`,
        { mode: 0o755 },
      );
      const tunnel = launchQuickTunnel({ binPath, localUrl: "http://127.0.0.1:4321" });
      started.push(tunnel);

      const code = await new Promise<unknown>((resolve) => tunnel.once("exit", resolve));

      expect(code).toBe(1);
      expect(tunnel.recentLog()).toContain("failed to request quick Tunnel: 429");
    });
  });

  describe("when the binary cannot be started", () => {
    it("reports an error", async () => {
      const tunnel = launchQuickTunnel({
        binPath: path.join(dir, "missing"),
        localUrl: "http://127.0.0.1:4321",
      });

      const error = await new Promise<Error>((resolve) => tunnel.once("error", resolve));

      expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
    });
  });
});
