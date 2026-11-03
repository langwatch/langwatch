import type { QueueSendResult } from "./contracts.ts";

/** Jobs per `stageBatch` call from `sendEach`: bounds one script's run, its arguments and reply. */
export const SEND_EACH_MAX_JOBS = 64;

/** Encoded bytes per `sendEach` batch, a first figure to measure; a larger job is staged alone. */
export const SEND_EACH_MAX_BYTES = 512 * 1024;

/** Payloads prepared at once by `sendEach`; preparing may upload an offloaded body. */
export const SEND_EACH_PREPARE_CONCURRENCY = 16;

/** Splits jobs, in order, into batches within both limits; a job over `maxBytes` goes alone. */
export function boundedStageBatches<Job extends { jobDataJson: string }>({
  jobs,
  maxJobs,
  maxBytes,
}: {
  jobs: readonly Job[];
  maxJobs: number;
  maxBytes: number;
}): Job[][] {
  const batches: Job[][] = [];
  let current: Job[] = [];
  let currentBytes = 0;
  for (const job of jobs) {
    const bytes = Buffer.byteLength(job.jobDataJson, "utf8");
    if (current.length > 0 && (current.length >= maxJobs || currentBytes + bytes > maxBytes)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(job);
    currentBytes += bytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Maps `run` over the items, at most `concurrency` at once, answering in input order. */
export async function mapInSlices<Item, Result>({
  items,
  concurrency,
  run,
}: {
  items: readonly Item[];
  concurrency: number;
  run: (item: Item, index: number) => Promise<Result>;
}): Promise<Result[]> {
  const results: Result[] = [];
  for (let start = 0; start < items.length; start += concurrency) {
    const slice = items.slice(start, start + concurrency);
    results.push(...(await Promise.all(slice.map((item, offset) => run(item, start + offset)))));
  }
  return results;
}

/**
 * Answers every input at its position: `prepare` refusing one rejects only that input, and
 * `send` answers the prepared ones in order. A thrown `send` leaves each of them unknown.
 */
export async function sendPreparedInOrder<Input, Prepared>({
  inputs,
  prepare,
  send,
}: {
  inputs: readonly Input[];
  prepare: (input: Input) => Prepared;
  send: (prepared: Prepared[]) => Promise<readonly QueueSendResult[]>;
}): Promise<QueueSendResult[]> {
  const results: (QueueSendResult | undefined)[] = [];
  const prepared: Prepared[] = [];
  const positions: number[] = [];
  for (const [index, input] of inputs.entries()) {
    try {
      prepared.push(prepare(input));
      positions.push(index);
      results.push(undefined);
    } catch (error) {
      results.push({ status: "rejected", error });
    }
  }
  if (prepared.length > 0) {
    const sent = await send(prepared).catch((error: unknown) =>
      prepared.map((): QueueSendResult => ({ status: "unknown", error })),
    );
    for (const [offset, position] of positions.entries()) {
      results[position] = sent[offset] ?? {
        status: "unknown",
        error: new Error("The queue gave no answer for this payload"),
      };
    }
  }
  return results.map(
    (result) => result ?? { status: "unknown", error: new Error("Payload was never sent") },
  );
}
