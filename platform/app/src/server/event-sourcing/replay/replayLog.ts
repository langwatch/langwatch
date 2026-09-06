/** Minimal log interface — CLI provides concrete implementation. */
// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

export interface ReplayLogWriter {
  write(entry: Record<string, unknown>): void;
}

/** No-op log for when no logging is needed. */
export const nullLog: ReplayLogWriter = { write() {} };
