import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { nowInstant } from "@langwatch/time";

import type { PredepTask } from "./types.ts";

// Download URL to disk with progress reporting. Throttled for spinner updates.
export async function downloadWithProgress({
  url,
  tmp,
  task,
  prefix,
}: {
  url: string;
  tmp: string;
  task: PredepTask;
  prefix: string;
}): Promise<void> {
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
      const now = nowInstant().epochMilliseconds;
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
