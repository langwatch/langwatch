import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { CacheTable } from "./cache-table.ts";

const ABANDONED_AFTER_MS = 60 * 60 * 1000;
// Each stored value is a u32 save stamp, then the value. Part of the file name's digest.
const FORMAT = "stamped-1";
const STAMP = 4;
const KEEP_FOR_SAVES = 200;
const MAX_BYTES = 96 * 1024 * 1024;

/**
 * One cache table on disk, read whole when a worker starts. What the worker adds is
 * merged with what is on disk when it saves, and swapped in by rename. Each save drops
 * entries no save touched in the last `keepForSaves`, then the oldest beyond `maxBytes`.
 */
export class CacheFile {
  readonly path: string;
  private readonly dir: string;
  private readonly prefix: string;
  private readonly keepForSaves: number;
  private readonly maxBytes: number;
  private readonly table: CacheTable;
  private readonly added = new Map<string, Buffer>();
  private readonly used = new Set<string>();

  /** `salt` names the file, so a change to anything in it starts a fresh one. */
  constructor({
    dir,
    name,
    salt,
    keepForSaves = KEEP_FOR_SAVES,
    maxBytes = MAX_BYTES,
  }: {
    dir: string;
    name: string;
    salt: string;
    keepForSaves?: number;
    maxBytes?: number;
  }) {
    const digest = createHash("sha1").update(`${FORMAT}\0${salt}`).digest("hex").slice(0, 16);
    this.dir = dir;
    this.prefix = `${name}-`;
    this.path = join(dir, `${name}-${digest}.bin`);
    this.keepForSaves = keepForSaves;
    this.maxBytes = maxBytes;
    this.table = new CacheTable(readOrUndefined(this.path));
  }

  get size(): number {
    return this.table.size;
  }

  get(key: string): Buffer | undefined {
    const added = this.added.get(key);
    if (added) return added;
    const stored = this.table.get(key);
    if (!stored || stored.length < STAMP) return undefined;
    this.used.add(key);
    return stored.subarray(STAMP);
  }

  set(key: string, value: Buffer): void {
    this.added.set(key, value);
  }

  /** Never throws: a cache that cannot be written is a slower next run, not a failure. */
  save(): void {
    if (this.added.size === 0) return;
    try {
      mkdirSync(this.dir, { recursive: true });
      const onDisk = new CacheTable(readOrUndefined(this.path));
      writeFileSync(this.temporaryPath(), CacheTable.build(this.merge(onDisk)));
      renameSync(this.temporaryPath(), this.path);
      this.added.clear();
      this.used.clear();
      this.prune();
    } catch {
      // Left for the next run to fill.
    }
  }

  /** What is on disk plus what this worker added, stamped, aged out and cut to the cap. */
  private merge(onDisk: CacheTable): Map<string, Buffer> {
    const stored: [string, number, Buffer][] = [];
    let latest = 0;
    for (const [key, value] of onDisk.entries()) {
      if (value.length < STAMP || this.added.has(key)) continue;
      const stamp = value.readUInt32LE(0);
      latest = Math.max(latest, stamp);
      stored.push([key, stamp, value.subarray(STAMP)]);
    }
    const now = latest + 1;
    const kept: [string, number, Buffer][] = [...this.added].map(([key, value]) => [
      key,
      now,
      value,
    ]);
    for (const [key, stamp, value] of stored) {
      const touched = this.used.has(key) ? now : stamp;
      if (now - touched <= this.keepForSaves) kept.push([key, touched, value]);
    }
    kept.sort((a, b) => b[1] - a[1]);
    const merged = new Map<string, Buffer>();
    let bytes = 0;
    for (const [key, stamp, value] of kept) {
      bytes += key.length + value.length + STAMP + 16;
      if (bytes > this.maxBytes) break;
      const header = Buffer.alloc(STAMP);
      header.writeUInt32LE(stamp, 0);
      merged.set(key, Buffer.concat([header, value]));
    }
    return merged;
  }

  private temporaryPath(): string {
    return `${this.path}.${process.pid}.tmp`;
  }

  /**
   * Files of this name under another salt belong to an older install or Node. A
   * temporary file an hour older than the one just written is one a killed worker never renamed.
   */
  private prune(): void {
    const own = this.path.slice(this.dir.length + 1);
    const savedAt = statSync(this.path).mtimeMs;
    for (const file of readdirSync(this.dir)) {
      if (!file.startsWith(this.prefix) || file === own) continue;
      const path = join(this.dir, file);
      if (file.endsWith(".bin") || isAbandoned(path, savedAt)) rmSync(path, { force: true });
    }
  }
}

function isAbandoned(path: string, savedAt: number): boolean {
  const stat = path.endsWith(".tmp") ? statSync(path, { throwIfNoEntry: false }) : undefined;
  return stat !== undefined && savedAt - stat.mtimeMs > ABANDONED_AFTER_MS;
}

function readOrUndefined(path: string): Buffer | undefined {
  try {
    return readFileSync(path);
  } catch {
    return undefined;
  }
}
