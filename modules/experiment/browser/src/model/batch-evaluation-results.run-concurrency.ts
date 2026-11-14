/** What a run's concurrency badge means, for its tooltip and its accessible description. */
export function runConcurrencyExplanation(concurrency: number): string {
  return concurrency === 1
    ? "Ran one cell at a time. A cell is one row against one target."
    : `Ran up to ${concurrency} cells at once. A cell is one row against one target.`;
}
