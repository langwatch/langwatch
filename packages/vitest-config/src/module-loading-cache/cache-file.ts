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

/**
 * One cache table on disk, read whole when a worker starts. What the worker adds is
 * merged with whatever other workers wrote meanwhile and swapped in by rename.
 */
export class CacheFile {
  readonly path: string;
  private readonly dir: string;
  private readonly prefix: string;
  private table: CacheTable;
  private readonly added = new Map<string, Buffer>();

  /** `salt` names the file, so a change to anything in it starts a fresh one. */
  constructor({ dir, name, salt }: { dir: string; name: string; salt: string }) {
    const digest = createHash("sha1").update(salt).digest("hex").slice(0, 16);
    this.dir = dir;
    this.prefix = `${name}-`;
    this.path = join(dir, `${name}-${digest}.bin`);
    this.table = new CacheTable(readOrUndefined(this.path));
  }

  get size(): number {
    return this.table.size;
  }

  get(key: string): Buffer | undefined {
    return this.added.get(key) ?? this.table.get(key);
  }

  set(key: string, value: Buffer): void {
    this.added.set(key, value);
  }

  /** Never throws: a cache that cannot be written is a slower next run, not a failure. */
  save(): void {
    if (this.added.size === 0) return;
    try {
      mkdirSync(this.dir, { recursive: true });
      const merged = new Map(new CacheTable(readOrUndefined(this.path)).entries());
      for (const [key, value] of this.added) merged.set(key, value);
      const temporary = `${this.path}.${process.pid}.tmp`;
      writeFileSync(temporary, CacheTable.build(merged));
      renameSync(temporary, this.path);
      this.added.clear();
      this.prune();
    } catch {
      // Left for the next run to fill.
    }
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
