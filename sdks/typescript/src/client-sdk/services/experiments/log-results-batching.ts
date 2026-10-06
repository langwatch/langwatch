/**
 * Sizes `log_results` requests by bytes. Results are batched by time and one row can carry
 * megabytes of inline images, so a batch above the request target is sent as several
 * requests, each holding whole entries in their original order.
 */
import { type LogResultsRequest } from "./types.ts";

/**
 * The most bytes of entries one log_results request carries, unless a single entry is larger
 * than this on its own. It stays under the request limit of every server version an SDK can
 * talk to.
 */
export const LOG_RESULTS_TARGET_BYTES = 16 * 1024 * 1024;

type DatasetEntry = LogResultsRequest["dataset"][number];
type EvaluationEntry = LogResultsRequest["evaluations"][number];

type SizedEntry =
  | { kind: "dataset"; entry: DatasetEntry; bytes: number }
  | { kind: "evaluation"; entry: EvaluationEntry; bytes: number };

const encoder = new TextEncoder();

/** The size of a value once it is serialized into a request body. */
export function serializedBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value) ?? "").length;
}

function entriesOf(body: LogResultsRequest): SizedEntry[] {
  return [
    ...body.dataset.map(
      (entry): SizedEntry => ({ kind: "dataset", entry, bytes: serializedBytes(entry) }),
    ),
    ...body.evaluations.map(
      (entry): SizedEntry => ({ kind: "evaluation", entry, bytes: serializedBytes(entry) }),
    ),
  ];
}

/**
 * One request body per group of entries. Every part repeats the run's own fields. The targets
 * go with the first part, and the timestamps that end the run go with the last one.
 */
function partsOf(body: LogResultsRequest, groups: SizedEntry[][]): LogResultsRequest[] {
  return groups.map((group, position) => ({
    ...body,
    dataset: group.flatMap((sized) => (sized.kind === "dataset" ? [sized.entry] : [])),
    evaluations: group.flatMap((sized) => (sized.kind === "evaluation" ? [sized.entry] : [])),
    targets: position === 0 ? body.targets : [],
    timestamps:
      position === groups.length - 1
        ? body.timestamps
        : { created_at: body.timestamps.created_at, finished_at: null },
  }));
}

/**
 * Splits a log_results body into requests of at most `targetBytes` of entries. Entries keep
 * their order, and an entry larger than the target is sent alone. A body that already fits
 * is returned as it is.
 */
export function splitLogResultsBody(
  body: LogResultsRequest,
  targetBytes: number = LOG_RESULTS_TARGET_BYTES,
): LogResultsRequest[] {
  const entries = entriesOf(body);
  const totalBytes = entries.reduce((sum, sized) => sum + sized.bytes, 0);
  if (totalBytes <= targetBytes) return [body];

  const groups: SizedEntry[][] = [];
  let groupBytes = 0;
  for (const sized of entries) {
    if (groups.length === 0 || groupBytes + sized.bytes > targetBytes) {
      groups.push([]);
      groupBytes = 0;
    }
    groups[groups.length - 1]!.push(sized);
    groupBytes += sized.bytes;
  }
  return partsOf(body, groups);
}

/**
 * Cuts a log_results body in two requests that each hold about half the bytes. Answers
 * `null` when the body holds fewer than two entries and so cannot be cut.
 */
export function halveLogResultsBody(body: LogResultsRequest): LogResultsRequest[] | null {
  const entries = entriesOf(body);
  if (entries.length < 2) return null;

  const half = entries.reduce((sum, sized) => sum + sized.bytes, 0) / 2;
  let read = 0;
  let cut = entries.length - 1;
  for (const [position, sized] of entries.entries()) {
    read += sized.bytes;
    if (read >= half) {
      cut = Math.min(Math.max(position + 1, 1), entries.length - 1);
      break;
    }
  }
  return partsOf(body, [entries.slice(0, cut), entries.slice(cut)]);
}

/** Names the single entry of a request the server refused, with its serialized size. */
export function describeRefusedEntry(body: LogResultsRequest): string {
  const [sized] = entriesOf(body);
  if (!sized) return "The request";

  const megabytes = (sized.bytes / (1024 * 1024)).toFixed(1);
  const kind = sized.kind === "evaluation" ? "evaluation result" : "result";
  const index = sized.entry.index;
  const subject =
    index === undefined || index === null ? `One ${kind}` : `The ${kind} for row index ${index}`;
  return `${subject} is ${megabytes} MB when serialized`;
}

/** Whether a request carries the timestamps that end the run. */
export function endsTheRun(body: LogResultsRequest): boolean {
  return (
    (body.timestamps.finished_at ?? null) !== null || (body.timestamps.stopped_at ?? null) !== null
  );
}
