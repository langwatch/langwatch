import { APIError } from "better-auth/api";
import { mfaCeremonies } from "~/server/app-layer/identity/runtime";

/**
 * Turning a completed two-factor endpoint call into the identity fact it
 * means (D06, follow-up 1).
 *
 * Bound to better-auth's `hooks.after`, which is the only seam that sees a
 * two-factor call at all: `databaseHooks` do not fire for a plugin's own
 * tables, so the `TwoFactor` row appearing is invisible to the identity
 * ceremonies that handle `Account` and `User`. That is why the
 * `MfaEnrollment` aggregate had a pipeline, guards, commands and a projection
 * and no writer — this is the writer.
 *
 * Nothing here reads a secret or a code. The endpoint has already done the
 * protocol; what reaches this file is a path, whether it succeeded, and whose
 * account it was.
 */

/** The endpoints whose success states a fact, and which verb each states. */
const CEREMONY_BY_PATH = {
  "/two-factor/enable": "enable",
  "/two-factor/verify-totp": "verify-totp",
  "/two-factor/verify-backup-code": "verify-backup-code",
  "/two-factor/generate-backup-codes": "generate-backup-codes",
  "/two-factor/disable": "disable",
} as const;

type CeremonyVerb = (typeof CEREMONY_BY_PATH)[keyof typeof CEREMONY_BY_PATH];

/**
 * What the after-hook gives us, structurally. Kept to the fields actually
 * read so this file does not track better-auth's context type version to
 * version — the same discipline `IdentityCeremonies` applies to row shapes.
 */
export interface TwoStepEndpointContext {
  path?: string;
  context?: {
    returned?: unknown;
    session?: { user?: { id?: unknown } } | null;
    newSession?: { user?: { id?: unknown } } | null;
  };
}

/**
 * State the fact a finished two-factor call implies, if it implies one.
 *
 * Returns having done nothing for every other path, for a call that failed,
 * and for a call we cannot attribute to a person — none of which is an error.
 * A failure inside a ceremony is swallowed by the ceremony itself: the
 * endpoint has already answered, and turning a successful sign-in into an
 * error over a record-keeping problem would be the wrong trade every time.
 */
export async function runTwoStepCeremony(
  ctx: TwoStepEndpointContext,
): Promise<void> {
  const verb = ceremonyVerbFor({ path: ctx.path });
  if (!verb) return;
  // After-hooks run for refusals too — better-auth puts the `APIError` in
  // `returned` rather than throwing past them — so this is what keeps a wrong
  // code from being recorded as a setup.
  if (ctx.context?.returned instanceof APIError) return;

  const userId = userIdIn(ctx);
  if (!userId) return;

  const ceremonies = mfaCeremonies();
  switch (verb) {
    case "enable":
      return ceremonies.afterEnable({ userId });
    case "verify-totp":
      return ceremonies.afterVerifyTotp({ userId });
    case "verify-backup-code":
      return ceremonies.afterVerifyBackupCode({ userId });
    case "generate-backup-codes":
      return ceremonies.afterGenerateBackupCodes({ userId });
    case "disable":
      return ceremonies.afterDisable({ userId });
  }
}

export function ceremonyVerbFor({
  path,
}: {
  path: string | undefined;
}): CeremonyVerb | null {
  if (!path) return null;
  return CEREMONY_BY_PATH[path as keyof typeof CEREMONY_BY_PATH] ?? null;
}

/**
 * Whose account this was.
 *
 * The freshly minted session first, because that is the shape of the calls
 * that finish a challenge — a session exists after them and did not before.
 * The caller's own session second, for the calls that require one already
 * (setting up, turning off, generating a new set of codes).
 */
export function userIdIn(ctx: TwoStepEndpointContext): string | null {
  const candidates = [
    ctx.context?.newSession?.user?.id,
    ctx.context?.session?.user?.id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}
