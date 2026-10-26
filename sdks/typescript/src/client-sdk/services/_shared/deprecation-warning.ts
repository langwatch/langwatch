/** What a caller of `/api/v1/dashboards` is told once the server marks it deprecated. */
export const DASHBOARDS_DEPRECATION_WARNING =
  "Warning: /api/v1/dashboards is deprecated for this project; use `langwatch boards` (/api/v1/boards).";

const warned = new Set<string>();

/**
 * Writes `message` to stderr once per process when `response` carries a `Deprecation` header.
 * Stderr only, so `-f json` output on stdout stays parseable; the call itself keeps working.
 */
export function warnOnceIfDeprecated({
  response,
  message,
}: {
  response: Response | undefined;
  message: string;
}): void {
  if (!response?.headers.get("Deprecation") || warned.has(message)) return;
  warned.add(message);
  process.stderr.write(`${message}\n`);
}

/** Forgets which warnings were written; for tests only. */
export function resetDeprecationWarnings(): void {
  warned.clear();
}
