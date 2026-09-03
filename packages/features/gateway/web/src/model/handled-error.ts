/**
 * The handled-error payload, as much of it as this family reads.
 *
 * `platform/app/src/features/errors/logic/readHandledError.ts` validates the
 * whole envelope from both boundaries and hands back nine fields. This family
 * asks it two questions — which code came back, and whether the server named a
 * field that was rejected — so that is what travels here. The rest of the
 * reader belongs with the presentation registry it feeds, and both move
 * together in a later slice.
 *
 * Trusts nothing: a misconfigured or older server must not be able to crash a
 * render by omitting a field.
 */

export type GatewayHandledError = {
  code: string;
  httpStatus: number;
  /** Whatever the code documented. Read by key, never spread into the UI. */
  meta: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The tRPC envelope's payload, or `null` when the failure was not a handled one. */
export function readHandledError(error: unknown): GatewayHandledError | null {
  const candidate = (error as { data?: { error?: unknown } } | null)?.data?.error;
  if (!isRecord(candidate)) return null;

  const code = typeof candidate.code === "string" ? candidate.code : null;
  if (code === null) return null;
  if (typeof candidate.httpStatus !== "number") return null;

  return {
    code,
    httpStatus: candidate.httpStatus,
    meta: isRecord(candidate.meta) ? candidate.meta : {},
  };
}
