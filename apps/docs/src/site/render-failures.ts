export type SkippedPage = { slug: string; reason: string };

/** Logs the most common render failures, then fails the build naming every page that failed. */
export function failOnSkippedPages({
  skipped,
  log = console.log,
}: {
  skipped: SkippedPage[];
  log?: (line: string) => void;
}) {
  const reasons = new Map<string, { count: number; example: string }>();
  for (const { slug, reason } of skipped) {
    const entry = reasons.get(reason) ?? { count: 0, example: slug };
    entry.count += 1;
    reasons.set(reason, entry);
  }
  for (const [reason, { count, example }] of [...reasons]
    .toSorted((a, b) => b[1].count - a[1].count)
    .slice(0, 15)) {
    log(`  ${count}x ${reason} (e.g. ${example}.mdx)`);
  }
  if (skipped.length > 0)
    throw new Error(
      `Documentation rendering failed for ${skipped.length} pages: ${skipped.map(({ slug }) => `${slug}.mdx`).join(", ")}`,
    );
}
