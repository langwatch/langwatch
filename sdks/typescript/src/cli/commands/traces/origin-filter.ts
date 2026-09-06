/**
 * Parse the CLI's comma-separated `--origin` value into the search API's
 * `filters["traces.origin"]` list.
 *
 * Origins are free-form strings on the platform (application, evaluation,
 * simulation, workflow, playground, gateway, langy, ...). The platform
 * coalesces traces with no recorded origin into "application", so filtering
 * by `application` also matches traces whose origin was never stamped.
 */
export function parseOriginOption(
  origin: string | undefined,
): string[] | undefined {
  if (origin === undefined) return undefined;

  const values = origin
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");

  return values.length > 0 ? values : undefined;
}
