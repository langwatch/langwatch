/** Minimal log interface — CLI provides concrete implementation. */
export interface ReplayLogWriter {
  write(entry: Record<string, unknown>): void;
}

/** No-op log for when no logging is needed. */
export const nullLog: ReplayLogWriter = { write() {} };
