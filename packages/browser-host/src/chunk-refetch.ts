/**
 * Asks for a chunk again under a fresh address. Engines that follow the HTML spec before
 * whatwg/html#10327 keep a failed module fetch in the module map and reject the same address
 * at once; a new query is a new entry, so this one is fetched.
 */
export function importChunkAgain<T>({
  url,
  attempt,
}: {
  url: string;
  attempt: number;
}): Promise<T> {
  const fresh = new URL(url);
  fresh.searchParams.set("retry", String(attempt));
  return import(/* @vite-ignore */ fresh.href);
}
