import { availableParallelism, freemem } from "node:os";
import { Worker } from "node:worker_threads";

import { z } from "zod";

const MAX_WORKERS = 4;
/* Conservative per-thread allowance until measured: each thread loads the whole SSR bundle. */
const WORKER_BYTES = 768 * 1024 * 1024;

/** At most four renderers, one core left for the parent, and only as many as free memory holds. */
export function renderWorkerCount({
  requested,
  cores = availableParallelism(),
  free = freemem(),
}: {
  requested?: number;
  cores?: number;
  free?: number;
}) {
  const bound = Math.min(MAX_WORKERS, cores - 1, Math.floor(free / WORKER_BYTES));
  return Math.max(1, Math.min(requested ?? MAX_WORKERS, bound));
}

const replySchema = z.object({
  index: z.number().int().nonnegative(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export type WorkerOutcome<Result> = { result: Result } | { error: string };

type Pool<Job, Result> = {
  script: URL;
  workerData: unknown;
  jobs: Job[];
  parseResult: (value: unknown) => Result;
  results: WorkerOutcome<Result>[];
  next: number;
  threads: Worker[];
};

/** Records one reply for the page `inFlight`; throws when it is out of turn or malformed. */
function acceptReply<Job, Result>({
  pool,
  message,
  inFlight,
}: {
  pool: Pool<Job, Result>;
  message: unknown;
  inFlight: number | null;
}) {
  const reply = replySchema.safeParse(message);
  if (!reply.success || reply.data.index !== inFlight)
    throw new Error("A renderer thread replied for a page it was not given");
  const { index, error, result } = reply.data;
  pool.results[index] = error === undefined ? { result: pool.parseResult(result) } : { error };
}

/** One thread: takes the next job whenever it finishes one, settles once it runs out of jobs. */
function startThread<Job, Result>({ pool }: { pool: Pool<Job, Result> }) {
  const worker = new Worker(pool.script, { workerData: pool.workerData });
  pool.threads.push(worker);
  let inFlight: number | null = null;
  let finished = false;
  return new Promise<void>((resolve, reject) => {
    const feed = () => {
      finished = pool.next >= pool.jobs.length;
      inFlight = finished ? null : pool.next;
      if (inFlight === null) return void worker.terminate();
      pool.next += 1;
      worker.postMessage({ index: inFlight, job: pool.jobs[inFlight] });
    };
    worker.on("message", (message: unknown) => {
      try {
        acceptReply({ pool, message, inFlight });
        feed();
      } catch (invalid) {
        reject(invalid);
      }
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (finished && inFlight === null) resolve();
      else reject(new Error(`A renderer thread exited with code ${code} before finishing a page`));
    });
    feed();
  });
}

/**
 * Runs jobs on independent worker threads of `script` and returns the outcomes in job order,
 * each result checked by `parseResult`. A job that throws comes back as its error message; a
 * thread that dies or replies out of turn stops every thread and fails the run.
 */
export async function runOnWorkers<Job, Result>({
  script,
  workerData,
  jobs,
  workers,
  parseResult,
}: {
  script: URL;
  workerData: unknown;
  jobs: Job[];
  workers: number;
  parseResult: (value: unknown) => Result;
}): Promise<WorkerOutcome<Result>[]> {
  const pool: Pool<Job, Result> = {
    script,
    workerData,
    jobs,
    parseResult,
    results: Array.from({ length: jobs.length }),
    next: 0,
    threads: [],
  };
  const count = Math.min(workers, jobs.length);
  try {
    await Promise.all(Array.from({ length: count }, () => startThread({ pool })));
  } catch (error) {
    await Promise.all(pool.threads.map((thread) => thread.terminate()));
    throw error;
  }
  return pool.results;
}
