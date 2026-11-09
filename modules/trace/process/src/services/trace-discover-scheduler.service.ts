/** Runs one facet discovery pass's tasks a few ClickHouse statements at a time. */

import type { DiscoverTask, Outcome } from "./trace-discover-task.service.ts";

/** One `settle` run: the statements it holds, the task it starts next, and its results. */
class CappedRun {
  private readonly settled: PromiseSettledResult<Outcome>[];
  private held = 0;
  private next = 0;
  private open: number;

  constructor(
    private readonly run: {
      tasks: readonly DiscoverTask[];
      limit: number;
      resolve: (settled: PromiseSettledResult<Outcome>[]) => void;
    },
  ) {
    this.settled = Array.from({ length: run.tasks.length });
    this.open = run.tasks.length;
  }

  start(): void {
    if (this.open === 0) return this.run.resolve(this.settled);
    this.pump();
  }

  /** Starts every task the held statements leave room for. */
  private pump(): void {
    while (this.next < this.run.tasks.length) {
      if (!this.startNext()) return;
    }
  }

  /** False when the next task must wait for a running one to give its statements back. */
  private startNext(): boolean {
    const index = this.next;
    const task = this.run.tasks[index]!;
    const weight = Math.min(task.statements, this.run.limit);
    if (this.held > 0 && this.held + weight > this.run.limit) return false;
    this.next += 1;
    this.held += weight;
    void (async () => task.run())()
      .then(
        (value) => this.finish(index, { status: "fulfilled", value }),
        (reason: unknown) => this.finish(index, { status: "rejected", reason }),
      )
      .finally(() => {
        this.held -= weight;
        this.pump();
      });
    return true;
  }

  private finish(index: number, result: PromiseSettledResult<Outcome>): void {
    this.settled[index] = result;
    this.open -= 1;
    if (this.open === 0) this.run.resolve(this.settled);
  }
}

export class TraceDiscoverSchedulerService {
  private constructor() {}

  static create(): TraceDiscoverSchedulerService {
    return new TraceDiscoverSchedulerService();
  }

  /** Runs `tasks` holding at most `limit` statements at once, settled in input order. */
  settle({
    tasks,
    limit,
  }: {
    tasks: readonly DiscoverTask[];
    limit: number;
  }): Promise<PromiseSettledResult<Outcome>[]> {
    return new Promise((resolve) => new CappedRun({ tasks, limit, resolve }).start());
  }
}
