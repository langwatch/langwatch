/**
 * Bound a promise by a time budget. The timer never keeps the process alive
 * (`unref`) and is cleared the moment the work settles; an overrun rejects
 * with the error the caller supplies, so each seam names its own failure.
 * The underlying work is NOT cancelled — callers treat an overrun as a drop
 * and let the work's own settlement be ignored.
 */
export function withinBudget<T>({
  work,
  timeoutMs,
  onTimeout,
}: {
  work: Promise<T>;
  timeoutMs: number;
  onTimeout: () => Error;
}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), timeoutMs);
    timer.unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });
}
