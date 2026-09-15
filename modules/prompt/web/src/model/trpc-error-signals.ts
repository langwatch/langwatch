/**
 * The two refusals that must not close a dialog, recognised structurally:
 * a feature-web package may not import `@trpc/client` (ADR-004), so these
 * duck-type the payload instead. Kept because a plan-limit/lite-member
 * refusal shows as a MODAL from a global interceptor, and the dialog stays
 * open under it rather than dismiss behind an unseen message.
 */

type SerializedRefusal = {
  data?: {
    code?: string;
    error?: { code?: string; kind?: string; meta?: { resource?: string } };
    cause?: { limitType?: string; current?: number; max?: number };
  };
};

function asSerializedRefusal(error: unknown): SerializedRefusal | null {
  if (typeof error !== "object" || error === null) return null;
  const data = (error as SerializedRefusal).data;
  if (typeof data !== "object" || data === null) return null;
  return error as SerializedRefusal;
}

/** The reader's membership does not allow this write. */
export function isLiteMemberRestriction(error: unknown): boolean {
  const refusal = asSerializedRefusal(error);
  if (!refusal || refusal.data?.code !== "UNAUTHORIZED") return false;
  // `kind` is the deprecated pre-`HandledError` discriminant, read as a
  // fallback so this resolves across the transition.
  const handled = refusal.data?.error;
  return (handled?.code ?? handled?.kind) === "lite_member_restricted";
}

/** The organization is at a plan limit. */
export function isLimitExceeded(error: unknown): boolean {
  const refusal = asSerializedRefusal(error);
  if (!refusal || refusal.data?.code !== "FORBIDDEN") return false;
  return typeof refusal.data?.cause?.limitType === "string";
}
