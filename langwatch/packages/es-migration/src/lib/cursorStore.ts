import { readFile, writeFile } from "node:fs/promises";
import type { Cursor, CursorStore } from "./types.js";

/**
 * Default rewind: back up the cursor timestamp on load (in ms).
 *
 * When the migration is interrupted, in-memory buffers (e.g. simulation run
 * aggregates waiting for a FINISH event) are lost. On restart we need to
 * re-read far enough back to pick up those START events again. The existence
 * checker deduplicates already-processed aggregates, so overlap is safe.
 *
 * 24 hours covers even long-running simulation runs whose events may span
 * many hours.  For self-contained migrations like traces-combined, set
 * CURSOR_REWIND_MS=0 to resume from the exact cursor position.
 */
const DEFAULT_CURSOR_REWIND_MS = 24 * 60 * 60 * 1000; // 24 hours

export class FileCursorStore implements CursorStore {
  private readonly rewindMs: number;

  constructor(private readonly filePath: string = "./cursor.json") {
    const envRewind = process.env.CURSOR_REWIND_MS;
    if (envRewind !== undefined) {
      const parsed = parseInt(envRewind, 10);
      this.rewindMs = Number.isNaN(parsed)
        ? DEFAULT_CURSOR_REWIND_MS
        : parsed;
    } else {
      this.rewindMs = DEFAULT_CURSOR_REWIND_MS;
    }
  }

  async load(): Promise<Cursor | null> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.lastEventTimestamp !== "number") return null;

      if (this.rewindMs <= 0) {
        // No rewind — resume from the exact saved position (including sortValues).
        const cursor: Cursor = {
          lastEventTimestamp: parsed.lastEventTimestamp,
        };
        if (typeof parsed.lastEventId === "string") {
          cursor.lastEventId = parsed.lastEventId;
        }
        if (Array.isArray(parsed.sortValues)) {
          cursor.sortValues = parsed.sortValues;
        }
        return cursor;
      }

      // Back up the timestamp and drop sortValues so we re-scan a window
      // of events to recover any in-memory buffers lost during interruption.
      const cursor: Cursor = {
        lastEventTimestamp: parsed.lastEventTimestamp - this.rewindMs,
      };
      if (typeof parsed.lastEventId === "string") {
        cursor.lastEventId = parsed.lastEventId;
      }
      // Intentionally drop sortValues — search_after would skip past the
      // rewound timestamp, defeating the purpose of the rewind.
      return cursor;
    } catch {
      return null;
    }
  }

  async save(cursor: Cursor): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(cursor) + "\n");
  }
}
