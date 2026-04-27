import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { PredepTask } from "./types.ts";

/**
 * Stream-download a URL to disk while reporting MB / total MB to the
 * listr2 task spinner. Used by every predep that fetches a tarball
 * (postgres, redis, clickhouse, goose, aigateway) so the user sees
 * docker-pull-style progress instead of a static "downloading…" line.
 *
 * Throttled to ~10 updates/sec — listr2's renderer can't keep up with
 * per-chunk updates anyway, and excessive task.output writes flicker
 * the spinner.
 */
export async function downloadWithProgress(
  url: string,
  tmp: string,
  task: PredepTask,
  prefix: string,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`${prefix} download failed (${url}): HTTP ${res.status}`);
  }
  const total = Number(res.headers.get("content-length")) || 0;
  const totalLabel = total ? formatMB(total) : "?";
  let downloaded = 0;
  let lastUpdate = 0;

  const reporter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      downloaded += chunk.length;
      const now = Date.now();
      if (now - lastUpdate > 100) {
        task.output = `${prefix} ${formatMB(downloaded)}${total ? ` / ${totalLabel}` : ""}`;
        lastUpdate = now;
      }
      cb(null, chunk);
    },
  });

  await pipeline(res.body as unknown as NodeJS.ReadableStream, reporter, createWriteStream(tmp));
  // Final 100% update so the spinner doesn't get stuck mid-progress.
  task.output = `${prefix} ${formatMB(downloaded)}${total ? ` / ${totalLabel}` : ""}`;
}

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
