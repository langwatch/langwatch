import { APIError } from "better-auth/api";
import { lastWayInGuard } from "~/server/app-layer/identity/runtime";

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

/** Whose organizations require a second step of them. */
export type RequiringOrganizations = (args: {
  userId: string;
}) => Promise<readonly { slug: string }[]>;

/** Whether a removal would leave somebody unable to sign in. */
export interface LastWayInPort {
  passkeyRemovalStrandsUser(args: {
    userId: string;
    passkeyId: string;
  }): Promise<boolean>;
}

export interface LastWayInGuardDeps {
  lastWayIn: LastWayInPort;
}

/** What the `before` hook hands the guard, and what it is asked about. */
export interface LastWayInRequest {
  pathname: string;
  userId: string | null;
  body: unknown;
  requiringOrganizations: RequiringOrganizations;
}

/**
 * The refusal, in the vocabulary better-auth answers a request with.
 *
 * The guard translates and nothing more: whether a passkey is somebody's last
 * way in is `LastWayInService`'s answer, and whether an organization requires
 * a second step is the two-step account's. What lives here is which endpoint
 * asked and which registered code the screen reads back.
 */
export class LastWayInGuard {
  constructor(private readonly deps: LastWayInGuardDeps) {}

  /**
   * Refuse a removal that would close the last door, before better-auth runs
   * it.
   *
   * Takes the session user from the request context — both endpoints require a
   * session, so a call arriving without one is refused by better-auth before
   * this is reached and there is nothing here to decide.
   */
  async refuseIfItClosesTheLastDoor({
    pathname,
    userId,
    body,
    requiringOrganizations,
  }: LastWayInRequest): Promise<void> {
    if (!userId) return;

    if (pathname === LAST_WAY_IN_PATHS.disableTwoFactor) {
      await this.refuseDisablingRequiredTwoStep({
        userId,
        requiringOrganizations,
      });
      return;
    }

    if (pathname === LAST_WAY_IN_PATHS.deletePasskey) {
      await this.refuseRemovingTheLastPasskey({ userId, body });
    }
  }

  /** An organization that requires a second step requires it of its members. */
  private async refuseDisablingRequiredTwoStep({
    userId,
    requiringOrganizations,
  }: {
    userId: string;
    requiringOrganizations: RequiringOrganizations;
  }): Promise<void> {
    const requiring = await requiringOrganizations({ userId });
    if (requiring.length === 0) return;
    throw APIError.from("BAD_REQUEST", {
      code: "MFA_REQUIRED_BY_ORGANIZATION",
      message:
        "Your organization requires a second step to sign in, so it cannot be turned off here.",
    });
  }

  /**
   * A body naming no passkey decides nothing: better-auth refuses it on its
   * own terms, and there is no removal here to weigh.
   */
  private async refuseRemovingTheLastPasskey({
    userId,
    body,
  }: {
    userId: string;
    body: unknown;
  }): Promise<void> {
    const passkeyId =
      typeof body === "object" && body !== null
        ? (body as { id?: unknown }).id
        : undefined;
    if (typeof passkeyId !== "string" || passkeyId.length === 0) return;

    const strands = await this.deps.lastWayIn.passkeyRemovalStrandsUser({
      userId,
      passkeyId,
    });
    if (!strands) return;
    throw APIError.from("BAD_REQUEST", {
      code: "LAST_WAY_IN",
      message:
        "This is the only way you can sign in. Add another sign-in method first, then remove this one.",
    });
  }
}

/**
 * Refuse a removal that would close the last door, before better-auth runs it.
 *
 * `prisma` is accepted and unused: the guard now reads through its own
 * repository, and the parameter is kept only so the one call site — the
 * `before` hook in `index.ts` — is untouched while ADR-129 lands in slices.
 */
export function refuseIfItClosesTheLastDoor({
  pathname,
  userId,
  body,
  requiringOrganizations,
}: LastWayInRequest & { prisma?: unknown }): Promise<void> {
  return lastWayInGuard().refuseIfItClosesTheLastDoor({
    pathname,
    userId,
    body,
    requiringOrganizations,
  });
}
