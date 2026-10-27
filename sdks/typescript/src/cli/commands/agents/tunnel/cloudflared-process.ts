/**
 * The running `cloudflared` quick tunnel: spawns the verified binary and
 * reports the public URL it prints, the process exiting, or it failing to
 * start.
 */

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import * as readline from "node:readline";

/**
 * The hostname Cloudflare assigns a quick tunnel, as cloudflared logs it.
 * `api.trycloudflare.com` is the service cloudflared asks for a tunnel, and
 * it appears in the log when that request fails, so it is never the URL.
 */
const QUICK_TUNNEL_URL = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;

/** How many of cloudflared's last log lines a failure carries. */
const RECENT_LOG_LINES = 10;

/** The tunnel process surface the session needs. */
export interface TunnelHandle {
  stop: () => void;
  /** cloudflared's last few log lines, for an error that has no URL to show. */
  recentLog: () => string;
  once(event: "url", listener: (url: string) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number | null, signal: unknown) => void): unknown;
}

/**
 * Starts `cloudflared tunnel --url <localUrl>` and emits `url` once with the
 * public URL it logs. Both streams are read line by line for the whole session.
 */
export function launchQuickTunnel({
  binPath,
  localUrl,
}: {
  binPath: string;
  localUrl: string;
}): TunnelHandle {
  const events = new EventEmitter();
  // Without --no-autoupdate cloudflared swaps itself for an unchecked release.
  const child = spawn(binPath, ["tunnel", "--no-autoupdate", "--url", localUrl], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let hasReportedUrl = false;
  const recent: string[] = [];
  const onLine = (line: string) => {
    recent.push(line);
    if (recent.length > RECENT_LOG_LINES) recent.shift();
    if (hasReportedUrl) return;
    const match = QUICK_TUNNEL_URL.exec(line);
    if (match) {
      hasReportedUrl = true;
      events.emit("url", match[0]);
    }
  };
  // Line by line, so a URL split across chunks is found and the pipe never fills.
  for (const stream of [child.stdout, child.stderr]) {
    readline.createInterface({ input: stream }).on("line", onLine);
  }

  child.on("error", (error) => events.emit("error", error));
  child.on("exit", (code, signal) => events.emit("exit", code, signal));

  return {
    stop: () => {
      child.kill("SIGINT");
    },
    recentLog: () => recent.join("\n"),
    once: (event: string, listener: (...args: never[]) => void) =>
      events.once(event, listener as (...args: unknown[]) => void),
  } as TunnelHandle;
}
