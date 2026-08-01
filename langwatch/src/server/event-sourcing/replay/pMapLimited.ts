/**
 * Maps `fn` over `items` with at most `concurrency` invocations in flight at
 * once, awaiting the next free slot before starting the following item. On the
 * first rejection it rejects immediately; any invocations still in flight at
 * that point continue running but go unobserved (no settle-all guarantee).
 */
export async function pMapLimited<T>({
  items,
  fn,
  concurrency,
}: {
  items: T[];
  fn: (item: T) => Promise<void>;
  concurrency: number;
}): Promise<void> {
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
