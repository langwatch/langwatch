import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isProcessAlive } from "./exclusive-lock.ts";

/** One file per running LangWatch, named by its pid and holding the app version it serves. */
function inUseDir(root: string): string {
  return join(root, "run", "app-in-use");
}

/** Records that this process serves `version` from app/<version>; returns its removal. */
export function recordAppInUse({
  root,
  version,
  pid = process.pid,
}: {
  root: string;
  version: string;
  pid?: number;
}): () => void {
  const dir = inUseDir(root);
  mkdirSync(dir, { recursive: true });
  const record = join(dir, String(pid));
  writeFileSync(record, version);
  return () => rmSync(record, { force: true });
}

/** The app versions a running LangWatch serves; records of processes that ended are removed. */
export function appVersionsInUse({ root }: { root: string }): Set<string> {
  const dir = inUseDir(root);
  const versions = new Set<string>();
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return versions;
  }
  for (const entry of entries) {
    const record = join(dir, entry);
    if (!isProcessAlive(Number(entry))) {
      rmSync(record, { force: true });
      continue;
    }
    try {
      versions.add(readFileSync(record, "utf8").trim());
    } catch {
      // Removed by its process between the listing and the read.
    }
  }
  return versions;
}
