/** The most of a run's error text a trace list summary carries. */
export const SUMMARY_ERROR_TEXT_MAX_CHARS = 300;

/**
 * The most the summary read pulls out of storage, so one huge provider error
 * page per run never travels the whole way; room is left for leading space.
 */
export const SUMMARY_ERROR_TEXT_READ_CHARS = 1_024;

/** An errored run's error text as a summary carries it: trimmed, cut short, or none. */
export function summaryErrorTextOf({
  status,
  error,
}: {
  readonly status: string;
  readonly error: string | null;
}): string | null {
  if (status !== "error" || error === null) return null;
  const text = error.trim();
  if (text === "") return null;
  return text.length <= SUMMARY_ERROR_TEXT_MAX_CHARS
    ? text
    : `${text.slice(0, SUMMARY_ERROR_TEXT_MAX_CHARS)}…`;
}
