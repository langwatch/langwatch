/** A read that runs `statements` ClickHouse statements at once. */
interface WeightedRead<T> {
  statements: number;
  run: () => Promise<T>;
}

/**
 * Runs `tasks` in order, holding at most `limit` statements at once; a task heavier than the limit
 * runs alone. Results come back in input order, a failed task as a rejection.
 */
export function settleCapped<T>(
  tasks: readonly WeightedRead<T>[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  let held = 0;
  let running: Promise<void>[] = [];
  let turn = Promise.resolve();
  const runs = tasks.map((task) => {
    const weight = Math.min(task.statements, limit);
    turn = turn.then(async () => {
      while (held > 0 && held + weight > limit) await Promise.race(running);
      held += weight;
    });
    const run = turn.then(() => task.run());
    const freed: Promise<void> = run
      .catch(() => undefined)
      .then(() => {
        held -= weight;
        running = running.filter((other) => other !== freed);
      });
    void turn.then(() => running.push(freed));
    return run;
  });
  return Promise.allSettled(runs);
}
