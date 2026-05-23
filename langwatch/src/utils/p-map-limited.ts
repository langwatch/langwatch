/**
 * Run an async fn over `items` with at most `concurrency` calls in flight.
 *
 * The callback is invoked once per item. Failures are not rethrown — the
 * caller is responsible for collecting them inside `fn` (so a single failure
 * doesn't short-circuit the rest of the dispatch, the way `Promise.all` does).
 */
export async function pMapLimited<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p = fn(item).then(() => {
      executing.delete(p);
    });
    executing.add(p);
    if (executing.size >= concurrency) await Promise.race(executing);
  }
  await Promise.all(executing);
}
