/**
 * The running `cloudflared` quick tunnel: spawns the verified binary and
 * reports the public URL it prints, the process exiting, or it failing to
 * start.
 */

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import * as readline from "node:readline";

/** The hostname Cloudflare assigns a quick tunnel, as cloudflared logs it. */
const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/** The tunnel process surface the session needs. */
export interface TunnelHandle {
  stop: () => void;
  once(event: "url", listener: (url: string) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number | null, signal: unknown) => void): unknown;
}

/**
 * Starts `cloudflared tunnel --url <localUrl>` from `binPath` and emits `url`
 * once with the public URL it logs. cloudflared writes its log to stderr; both
 * streams are read line by line for the whole session, so a URL split across
 * chunks is still found and a full pipe never stalls the tunnel.
 *
 * `--no-autoupdate` because cloudflared otherwise downloads a newer release
 * and restarts itself onto it, which would swap the verified binary for one
 * nobody checked in the middle of a session.
 */
export function launchQuickTunnel({
  binPath,
  localUrl,
}: {
  binPath: string;
  localUrl: string;
}): TunnelHandle {
  const events = new EventEmitter();
  const child = spawn(binPath, ["tunnel", "--no-autoupdate", "--url", localUrl], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let reported = false;
  const onLine = (line: string) => {
    if (reported) return;
    const match = QUICK_TUNNEL_URL.exec(line);
    if (match) {
      reported = true;
      events.emit("url", match[0]);
    }
  };
  for (const stream of [child.stdout, child.stderr]) {
    readline.createInterface({ input: stream }).on("line", onLine);
  }

  child.on("error", (error) => events.emit("error", error));
  child.on("exit", (code, signal) => events.emit("exit", code, signal));

  return {
    stop: () => {
      child.kill("SIGINT");
    },
    once: (event: string, listener: (...args: never[]) => void) =>
      events.once(event, listener as (...args: unknown[]) => void),
  } as TunnelHandle;
}
