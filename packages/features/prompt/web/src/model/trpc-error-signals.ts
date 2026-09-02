/**
 * The two refusals that must not close a dialog, recognised structurally.
 *
 * `platform/app/src/utils/trpcError.ts` reads these off `TRPCClientError`, and
 * a feature-web package may not import `@trpc/client` — the transport is the
 * application's, and naming it here is what ADR-004 seals off. So the two
 * predicates duck-type the serialized payload instead, which is the same shape
 * the wire carries and the only part either question ever read.
 *
 * WHY THE QUESTION EXISTS AT ALL: `platform/app` shows a plan-limit refusal and
 * a lite-member refusal as MODALS from a global mutation interceptor, so the
 * prompt dialogs deliberately stayed open underneath rather than dismissing
 * behind a message the reader had not seen yet. Nothing mounts those
 * interceptors above a screen served from `apps/ui` — the same recorded gap the
 * datasets and model-config families carry as `isReportedGlobally` — but the
 * behaviour is kept because the dialog staying open is right either way: the
 * reader's draft survives a refusal they can act on.
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
