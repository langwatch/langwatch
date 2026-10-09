/** The most of a run's error text a trace list summary carries. */
export const SUMMARY_ERROR_TEXT_MAX_CHARS = 300;

/** An errored run's error text as a summary carries it: trimmed, cut short, or none. */
export function deriveSummaryErrorText({
  status,
  error,
}: {
  readonly status: string;
  readonly error: string | null;
}): string | undefined {
  if (status !== "error" || error === null) return undefined;
  const text = error.trim();
  if (text === "") return undefined;
  return text.length <= SUMMARY_ERROR_TEXT_MAX_CHARS
    ? text
    : `${text.slice(0, SUMMARY_ERROR_TEXT_MAX_CHARS)}…`;
}
