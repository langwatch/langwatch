/**
 * Cloudflare quick-tunnel provisioning for a dev tunnel session: make sure
 * the pinned, checksum-verified `cloudflared` binary is on disk and start a
 * quick tunnel for the local URL.
 */

import { ensureCloudflaredBinary } from "./cloudflared-binary";

/** How long to wait for the tunnel to report its public URL. */
const TUNNEL_URL_TIMEOUT_MS = 30_000;

/** The tunnel process surface the session needs, satisfied by cloudflared's Tunnel. */
export interface TunnelHandle {
  stop: () => void;
  once(event: "url", listener: (url: string) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(
    event: "exit",
    listener: (code: number | null, signal: unknown) => void,
  ): unknown;
}

/**
 * Provision the Cloudflare quick tunnel via the `cloudflared` package, after
 * {@link ensureCloudflaredBinary} has put the pinned release on disk (with
 * the Cloudflare terms notice printed before any download) and verified it.
 * Resolves with the public URL and a handle to stop the tunnel; rejects when
 * no URL arrives within the timeout.
 *
 * The import is lazy on purpose: only tunnel-provisioning runs pay for it,
 * and `--tunnel-url` sessions never load it (CLI boot-graph rule).
 */
export async function startQuickTunnel({
  localUrl,
}: {
  localUrl: string;
}): Promise<{ url: string; tunnel: TunnelHandle }> {
  const cloudflared = await import("cloudflared");

  // Every run, not only the first: a binary already on disk may come from an
  // earlier release, another tool, or a tampered cache, and it must match the
  // pinned digest before it runs.
  await ensureCloudflaredBinary({ binPath: cloudflared.bin });

  const tunnel = cloudflared.Tunnel.quick(localUrl);
  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      tunnel.stop();
      reject(
        new Error(
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
        new Error(
          `The tunnel process exited (code ${code ?? "unknown"}) before reporting a URL. Try again, or bring your own tunnel with --tunnel-url.`,
        ),
      );
    });
  });

  return { url, tunnel };
}
