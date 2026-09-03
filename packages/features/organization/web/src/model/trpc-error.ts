/**
 * The status code and the message a tRPC failure carries, read structurally.
 *
 * `platform/app` reached for `error instanceof TRPCClientError`, which needs
 * `@trpc/client` — one of the imports ADR-004 seals off from a screen's
 * closure — and which is the wrong test anyway once an error has crossed a
 * serialisation boundary. Reading the shape is what the house rule asks for:
 * assert on `code`, never on the class.
 */

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
 * The message the SERVER wrote, where a code says it is customer copy.
 *
 * Only ever read behind a `FORBIDDEN` on these screens, and that is the whole
 * reason it is safe: the personal-workspace guards are the only thing that
 * raises one here, and their message is a sentence written for the customer.
 * Every other failure resolves its words from the code.
 */
export function trpcErrorMessage(error: unknown): string | undefined {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : void 0;
}
