import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { nowInstant } from "@langwatch/time";

import type { SupportedPlatform } from "../shared/platform.ts";
import type { PredepTask } from "./types.ts";

const RELEASE_ASSET_SLUGS: Partial<Record<SupportedPlatform, string>> = {
  "darwin-arm64": "darwin-arm64",
  "darwin-x64": "darwin-amd64",
  "linux-arm64": "linux-arm64",
  "linux-x64": "linux-amd64",
};

/** The platform's spelling in release asset names (`aigateway-<slug>`, `langwatch-app-<slug>`). */
export function releaseAssetSlug(platform: string): string | undefined {
  return RELEASE_ASSET_SLUGS[platform as SupportedPlatform];
}

export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

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

  await pipeline(Readable.fromWeb(res.body), reporter, createWriteStream(tmp));
  // Final 100% update so the spinner doesn't get stuck mid-progress.
  task.output = `${prefix} ${formatMB(downloaded)}${total ? ` / ${totalLabel}` : ""}`;
}

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
