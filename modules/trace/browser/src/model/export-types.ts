/**
 * What an export of the trace list is, as the browser half knows it.
 */

export type ExportFormat = "csv" | "jsonl" | "json";

export type ExportMode = "summary" | "full";

/**
 * How far a running export has got, as the progress subscription frames it.
 */
export type ExportProgressEvent = {
  type?: string;
  exported?: number;
  total?: number | null;
  url?: string | null;
  error?: string | null;
};

export type ExportProgress = {
  exported: number;
  total: number;
  type?: string;
  status?: "idle" | "running" | "done" | "failed" | "cancelled";
  error?: string | null;
  url?: string | null;
};
