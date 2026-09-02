/**
 * What an export of the trace list is, as the browser half knows it.
 *
 * `~/server/export/types` declares these next to a zod schema that composes
 * `~/server/analytics/types`, which is server-side; a browser package may
 * reach neither. Only the three names below crossed to the client, and they are
 * a union of literals in both places — restated here with the alignment
 * obligation the data-governance snapshots record. Whoever moves the export
 * service into its feature's server package deletes the platform copy and this
 * stops being a restatement.
 */

export type ExportFormat = "csv" | "jsonl" | "json";

export type ExportMode = "summary" | "full";

/** How far a running export has got, as the progress subscription frames it. */
/**
 * One frame of the progress stream, as the subscription pushes it.
 *
 * Separate from `ExportProgress`, which is the STATE a page keeps: a frame says
 * what just happened and carries a `type`, and the state carries the totals the
 * bar draws.
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
