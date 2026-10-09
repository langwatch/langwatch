/** Resolves with `work`, or rejects with the signal's reason once it aborts. */
export function settleBefore<T>({
  work,
  signal,
}: {
  work: Promise<T>;
  signal: AbortSignal;
}): Promise<T> {
  // A late rejection from abandoned work has nobody waiting for it.
  work.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}
