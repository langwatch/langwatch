import { Worker } from "node:worker_threads";

import type { DiffFiles, PixelDiff } from "./diff";

/** DiffReply is what diff-worker.ts answers one DiffFiles with. */
interface DiffReply {
  diff?: PixelDiff | null;
  error?: string;
}

interface DiffJob {
  files: DiffFiles;
  resolve: (diff: PixelDiff | null) => void;
  reject: (error: Error) => void;
}

/**
 * DiffPool decodes, compares and encodes screenshots on worker threads, so a
 * tall page's PNG work never stalls the pages capturing on the main thread.
 */
export class DiffPool {
  private readonly idle: Worker[] = [];
  private readonly all: Worker[] = [];
  private readonly queue: DiffJob[] = [];
  private readonly running = new Map<Worker, DiffJob>();
  private closing = false;

  constructor(size: number) {
    for (let index = 0; index < size; index++) this.idle.push(this.spawn());
  }

  /** spawn starts a worker; one that dies fails its job and is replaced, never reused. */
  private spawn(): Worker {
    const worker = new Worker(new URL("./diff-worker.ts", import.meta.url));
    worker.on("message", (reply: DiffReply) => this.answered({ worker, reply }));
    worker.on("error", (error: Error) => this.died({ worker, why: error.message }));
    worker.on("exit", (code) => this.died({ worker, why: `diff worker exited ${code}` }));
    this.all.push(worker);
    return worker;
  }

  private died({ worker, why }: { worker: Worker; why: string }): void {
    if (!this.all.includes(worker) || this.closing) return;
    this.all.splice(this.all.indexOf(worker), 1);
    const idleAt = this.idle.indexOf(worker);
    if (idleAt >= 0) this.idle.splice(idleAt, 1);
    this.running.get(worker)?.reject(new Error(why));
    this.running.delete(worker);
    this.idle.push(this.spawn());
    this.next();
  }

  diff(files: DiffFiles): Promise<PixelDiff | null> {
    return new Promise((resolve, reject) => {
      this.queue.push({ files, resolve, reject });
      this.next();
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.all(this.all.map((worker) => worker.terminate()));
  }

  private next(): void {
    const worker = this.idle.pop();
    if (worker === undefined) return;
    const job = this.queue.shift();
    if (job === undefined) {
      this.idle.push(worker);
      return;
    }
    this.running.set(worker, job);
    worker.postMessage(job.files);
  }

  private answered({ worker, reply }: { worker: Worker; reply: DiffReply }): void {
    const job = this.running.get(worker);
    this.running.delete(worker);
    this.idle.push(worker);
    if (job !== undefined && reply.error !== undefined) job.reject(new Error(reply.error));
    if (job !== undefined && reply.error === undefined) job.resolve(reply.diff ?? null);
    this.next();
  }
}
