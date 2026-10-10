/** Read tRPC error shape structurally: assert on code, never on class. */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The tRPC status code of a failure, when it carries one. */
export function trpcErrorCode(error: unknown): string | undefined {
  const data = (error as { data?: unknown } | null)?.data;
  if (!isRecord(data)) return void 0;
  return typeof data.code === "string" ? data.code : void 0;
}

/**
 * The message the SERVER wrote, where a code says it is customer copy —
 * only ever read behind a `FORBIDDEN`, since the personal-workspace guards
 * are the only thing raising one here with customer-written text.
 */
export function trpcErrorMessage(error: unknown): string | undefined {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : void 0;
}
