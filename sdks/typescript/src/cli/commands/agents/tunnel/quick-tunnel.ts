/**
 * Cloudflare quick-tunnel provisioning for a dev tunnel session: make sure
 * the pinned, checksum-verified `cloudflared` binary is on disk and start a
 * quick tunnel for the local URL.
 */

import * as path from "node:path";

import { configPath } from "../../../utils/governance/config";
import { ensureCloudflaredBinary } from "./cloudflared-binary";
import { launchQuickTunnel, type TunnelHandle } from "./cloudflared-process";

/** How long to wait for the tunnel to report its public URL. */
const TUNNEL_URL_TIMEOUT_MS = 30_000;

/**
 * Where the binary is cached: beside the CLI config, so it follows
 * LANGWATCH_CLI_CONFIG and survives package upgrades. The file is the CLI's
 * own, so one that does not match the pinned release is replaced.
 */
function cloudflaredBinPath(): string {
  const name = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  return path.join(path.dirname(configPath()), "bin", name);
}

/**
 * Starts the quick tunnel on the verified binary and resolves with its public
 * URL; rejects, carrying cloudflared's last log lines, when no URL arrives.
 */
export async function startQuickTunnel({
  localUrl,
}: {
  localUrl: string;
}): Promise<{ url: string; tunnel: TunnelHandle }> {
  const binPath = cloudflaredBinPath();

  // Every run, not only the first: a binary already on disk may come from an
  // earlier release or a tampered cache, and it must match the pinned digest
  // before it runs.
  await ensureCloudflaredBinary({ binPath });

  const tunnel = launchQuickTunnel({ binPath, localUrl });
  const failure = (message: string) => {
    const log = tunnel.recentLog();
    return new Error(log ? `${message}\n\ncloudflared said:\n${log}` : message);
  };
  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      tunnel.stop();
      reject(
        failure(
          `The tunnel did not report a public URL within ${TUNNEL_URL_TIMEOUT_MS / 1000} seconds. Check your network connection and try again, or bring your own tunnel with --tunnel-url.`,
        ),
      );
    }, TUNNEL_URL_TIMEOUT_MS);
    tunnel.once("url", (tunnelUrl: string) => {
      clearTimeout(timeout);
      resolve(tunnelUrl);
    });
    tunnel.once("error", (error: Error) => {
      clearTimeout(timeout);
      tunnel.stop();
      reject(error);
    });
    tunnel.once("exit", (code: number | null) => {
      clearTimeout(timeout);
      reject(
        failure(
          `The tunnel process exited (code ${code ?? "unknown"}) before reporting a URL. Try again, or bring your own tunnel with --tunnel-url.`,
        ),
      );
    });
  });

  return { url, tunnel };
}
