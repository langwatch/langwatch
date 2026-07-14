/**
 * Maps `fn` over `items` with at most `concurrency` invocations in flight at
 * once. Resolves when every invocation has settled; rejects on the first
 * failure.
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
