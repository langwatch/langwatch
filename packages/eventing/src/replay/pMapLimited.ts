/**
 * Maps `fn` over `items`, at most `concurrency` in flight. On first rejection
 * it rejects immediately; in-flight calls keep running but go unobserved
 * (no settle-all guarantee).
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
