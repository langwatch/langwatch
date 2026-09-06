/**
 * The tripwire behind ADR-057's core guarantee: anonymous access to trace data
 * flows through exactly ONE endpoint (`sharedTrace.get`), and every other
 * procedure requires a session. This walks the process's real procedure map, so
 * building a surface on the public procedure anywhere fails the suite until
 * this reviewed allowlist is deliberately extended.
 *
 * Spec: packages/features/share/specs/share.feature
 */
import { describe, expect, it } from "vitest";

import { buildAppTrpcFeatures, buildAppTrpcMount } from "./support/app-trpc-features";

/**
 * Before adding an entry, ask: does this endpoint leak tenant data to an
 * unauthenticated caller, and why can't it be a protected procedure?
 */
const PUBLIC_PROCEDURE_ALLOWLIST: string[] = [
  // Email unsubscribe links land here from a mail client — no session exists.
  // Both are gated by the single-purpose unsubscribe token in the URL.
  "emailSuppression.confirmUnsubscribe",
  "emailSuppression.resolveUnsubscribeToken",
  // The signed-out front door (ADR-117). Every one of these answers a question
  // somebody asks BEFORE they have a session, so none of them can be protected
  // without breaking sign-in itself. Each carries a no-permission reason at its
  // definition and its own per-IP rate limit.
  //
  // `route` is a mutation rather than a query on purpose: a per-address query
  // cache is an account-existence oracle built out of network timing. It reads
  // no user data — organization-level routing only.
  //
  // `inviteLanding` is the only one that returns anything tenant-shaped (an
  // organization name and the inviter's name). The invite code IS the
  // authorization, exactly as in `organization.acceptInvite`, and a revoked
  // invitation is answered identically to a missing one.
  "frontDoor.completeSignUpVerification",
  "frontDoor.inviteLanding",
  "frontDoor.requestFreshInvite",
  "frontDoor.requestSignUpVerification",
  "frontDoor.route",
  // Client bootstrap: exposes only the PUBLIC_* env whitelist, no tenant data.
  "publicEnv",
  // The one anonymous trace read. Token-gated by the share service's
  // resolve-for-viewer, and it answers the explicit share-safe payload. ADR-057.
  "sharedTrace.get",
  // Sign-up — necessarily pre-session.
  "user.register",
];

/** Every path this process answers on, and whether it skips authentication. */
function mountedProcedures(): Record<string, unknown> {
  const { trpc, mount, isPublicProcedure } = buildAppTrpcMount({ authenticate: true });
  const router = trpc.router(buildAppTrpcFeatures(mount) as never);
  const procedures = (router as unknown as { _def: { procedures: Record<string, unknown> } })._def
    .procedures;
  return Object.fromEntries(
    Object.entries(procedures).map(([path, procedure]) => [path, isPublicProcedure(procedure)]),
  );
}

describe("the app process's tRPC public surface", () => {
  describe("when the public (unauthenticated) procedures are enumerated", () => {
    /** @scenario "Adding a new public endpoint is a deliberate, reviewed act" */
    it("matches the reviewed allowlist exactly", () => {
      const procedures = mountedProcedures();

      const publicPaths = Object.entries(procedures)
        .filter(([, isPublic]) => isPublic)
        .map(([path]) => path)
        .sort();

      expect(publicPaths).toEqual([...PUBLIC_PROCEDURE_ALLOWLIST].sort());
    });

    /** @scenario "Adding a new public endpoint is a deliberate, reviewed act" */
    it("enumerates the whole surface, so a new public procedure is seen at all", () => {
      const procedures = mountedProcedures();

      // The sweep is only a tripwire if it reads every mounted path: a map that
      // came back with the allowlist alone would pass the check above forever.
      expect(Object.keys(procedures).length).toBeGreaterThan(PUBLIC_PROCEDURE_ALLOWLIST.length);
      for (const path of PUBLIC_PROCEDURE_ALLOWLIST) {
        expect(procedures, path).toHaveProperty([path], true);
      }
    });
  });
});
