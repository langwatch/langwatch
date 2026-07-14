// Returns a cancel function so callers can stop polling if the component
// unmounts or the value is no longer needed — otherwise a stale poll could
// call `onFound` with data belonging to whatever the global becomes later,
// after the caller stopped caring.
export function pollForGlobal<T>(
  getValue: () => T | undefined,
  onFound: (value: T) => void,
  {
    intervalMs = 250,
    timeoutMs = 10_000,
  }: { intervalMs?: number; timeoutMs?: number } = {},
): () => void {
  const existing = getValue();
  if (existing) {
    onFound(existing);
    // No poll was started, so there's nothing to cancel.
    return () => {
      /* noop */
    };
  }

  const deadline = Date.now() + timeoutMs;
  const interval = setInterval(() => {
    const value = getValue();
    if (value) {
      clearInterval(interval);
      onFound(value);
      return;
    }
    if (Date.now() >= deadline) {
      clearInterval(interval);
    }
  }, intervalMs);

  return () => clearInterval(interval);
}
