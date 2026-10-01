/** Parse CLI's comma-separated `--origin` into search API's
 * `filters["traces.origin"]` list. Missing origins coalesce as "application". */
export function parseOriginOption(origin: string | undefined): string[] | undefined {
  if (origin === undefined) return undefined;

  const values = origin
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");

  return values.length > 0 ? values : undefined;
}
