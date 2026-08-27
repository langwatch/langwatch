import { APIError } from "better-auth/api";
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * ADR-119, on the two doors that were not behind it.
 *
 * "An account is never left with one way in" is enforced by the detach guard,
 * which runs on `account.delete.before` — so it sees every removal that goes
 * through better-auth's `account` model. Two removals do not.
 *
 * A PASSKEY IS NOT AN ACCOUNT ROW. The passkey plugin owns its own table, so
 * deleting the last one reached no ceremony and no guard: somebody whose only
 * credential was one passkey could remove it and have no way back in. The
 * settings screen said the opposite in as many words — "the detach guards
 * decide this, and their refusal is a registered code" — which is exactly the
 * kind of comment that stops anybody checking.
 *
 * TURNING OFF THE SECOND FACTOR SKIPPED THE ORGANIZATION THAT REQUIRES IT.
 * `twoStepVerification.disable` refuses when the person belongs to an
 * organization with `mfaRequired`, and re-proves the current code first. The
 * plugin's own `/two-factor/disable` is mounted too and does neither. The
 * ledger's guard did fire — in the AFTER hook, where the ceremony catches it
 * and logs a warning, so the enrollment kept reading ENABLED for an account
 * with no factor at all.
 *
 * Both are refused BEFORE the endpoint runs, which is the only place a
 * refusal can still mean anything.
 */

/** The paths this guard answers for. */
export const LAST_WAY_IN_PATHS = {
  deletePasskey: "/passkey/delete-passkey",
  disableTwoFactor: "/two-factor/disable",
} as const;

export const isLastWayInPath = (pathname: string): boolean =>
  pathname === LAST_WAY_IN_PATHS.deletePasskey ||
  pathname === LAST_WAY_IN_PATHS.disableTwoFactor;

/**
 * Whether removing this passkey would leave the person unable to sign in.
 *
 * Counts what is LEFT rather than what is going, the way the detach guard
 * does: a password they can still use, a federated account still linked, or
 * another passkey. Any one of those is a way in and this refuses nothing.
 */
async function passkeyRemovalStrandsUser({
  prisma,
  userId,
  passkeyId,
}: {
  prisma: PrismaClient;
  userId: string;
  passkeyId: string;
}): Promise<boolean> {
  const [otherPasskeys, accounts] = await Promise.all([
    prisma.passkey.count({ where: { userId, id: { not: passkeyId } } }),
    prisma.account.findMany({
      where: { userId },
      select: { provider: true, password: true },
    }),
  ]);
  if (otherPasskeys > 0) return false;

  const hasUsableAccount = accounts.some((account) =>
    account.provider === "credential"
      ? typeof account.password === "string" && account.password.length > 0
      : // A federated account is a way in as long as the connection behind it
        // still dials, which is the identity provider's question rather than
        // ours. Counted as a way in, so this guard never stands between
        // somebody and removing a passkey they do not need.
        true,
  );
  return !hasUsableAccount;
}

/**
 * Refuse a removal that would close the last door, before better-auth runs it.
 *
 * Takes the session user from the request context — both endpoints require a
 * session, so a call arriving without one is refused by better-auth before
 * this is reached and there is nothing here to decide.
 */
export async function refuseIfItClosesTheLastDoor({
  pathname,
  userId,
  body,
  prisma,
  requiringOrganizations,
}: {
  pathname: string;
  userId: string | null;
  body: unknown;
  prisma: PrismaClient;
  requiringOrganizations: (args: {
    userId: string;
  }) => Promise<readonly { slug: string }[]>;
}): Promise<void> {
  if (!userId) return;

  if (pathname === LAST_WAY_IN_PATHS.disableTwoFactor) {
    const requiring = await requiringOrganizations({ userId });
    if (requiring.length > 0) {
      throw APIError.from("BAD_REQUEST", {
        code: "MFA_REQUIRED_BY_ORGANIZATION",
        message:
          "Your organization requires a second step to sign in, so it cannot be turned off here.",
      });
    }
    return;
  }

  if (pathname === LAST_WAY_IN_PATHS.deletePasskey) {
    const passkeyId =
      typeof body === "object" && body !== null
        ? (body as { id?: unknown }).id
        : undefined;
    if (typeof passkeyId !== "string" || passkeyId.length === 0) return;

    if (await passkeyRemovalStrandsUser({ prisma, userId, passkeyId })) {
      throw APIError.from("BAD_REQUEST", {
        code: "LAST_WAY_IN",
        message:
          "This is the only way you can sign in. Add another sign-in method first, then remove this one.",
      });
    }
  }
}
