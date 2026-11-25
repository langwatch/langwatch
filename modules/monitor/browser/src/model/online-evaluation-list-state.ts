/** What the online evaluations list shows: a spinner, the error, the empty state, or the rows. */
export function onlineEvaluationListState({
  isLoading,
  isError,
  count,
}: {
  isLoading: boolean;
  isError: boolean;
  count: number;
}): "loading" | "error" | "empty" | "list" {
  if (isLoading) return "loading";
  if (isError) return "error";
  return count === 0 ? "empty" : "list";
}
