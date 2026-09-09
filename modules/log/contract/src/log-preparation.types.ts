import type { CanonicalLogRecord } from "./log-record.ts";

export type LogPiiRedactionLevel = "STRICT" | "ESSENTIAL" | "DISABLED";

export type PreparedCanonicalLogRecord = {
  record: CanonicalLogRecord;
  normalized: {
    body: string;
    attributes: Record<string, string>;
    resourceAttributes: Record<string, string>;
    scopeName: string;
    scopeVersion: string | null;
  };
};

export type LogPreparation = {
  accepted: PreparedCanonicalLogRecord[];
  rejectedLogRecords: number;
  errors: string[];
};
