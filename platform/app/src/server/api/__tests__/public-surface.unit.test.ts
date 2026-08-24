import { describe, expect, it } from "vitest";
import { appRouter } from "../root";
import { isPublicProcedure } from "../trpc";

/**
 * The tripwire behind ADR-057's core guarantee: anonymous access to trace data
 * flows through exactly ONE endpoint (`sharedTrace.get`), and every other
 * procedure requires a session. This test walks the real router map, so adding
 * a `publicProcedure` anywhere fails the suite until this reviewed allowlist
 * is deliberately extended.
 *
 * Before adding an entry, ask: does this endpoint leak tenant data to an
 * unauthenticated caller, and why can't it be `protectedProcedure`?
 */
const PUBLIC_PROCEDURE_ALLOWLIST: string[] = [
  // Email unsubscribe links land here from a mail client — no session exists.
  // Both are gated by the single-purpose unsubscribe token in the URL.
  "emailSuppression.confirmUnsubscribe",
  "emailSuppression.resolveUnsubscribeToken",
  // The signed-out front door (ADR-117). Every one of these answers a
  // question somebody asks BEFORE they have a session, so none of them can
  // be a protectedProcedure without breaking sign-in itself. Each carries a
  // .noPermission reason at its definition and its own per-IP rate limit.
  //
  // `route` is a mutation rather than a query on purpose: a per-address
  // query cache is an account-existence oracle built out of network timing.
  // It reads no user data — org-level routing only.
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
  "frontDoor.startPasswordSignUp",
  // Client bootstrap: exposes only the PUBLIC_* env whitelist, no tenant data.
  "publicEnv",
  // The one anonymous trace read. Token-gated by ShareService.resolveForViewer;
  // returns the explicit share-safe SharedTraceDto. See ADR-057.
  "sharedTrace.get",
  // Sign-up — necessarily pre-session.
  "user.register",
];

describe("tRPC public surface", () => {
  describe("when enumerating procedures that skip authentication", () => {
    /** @scenario Adding a new public endpoint is a deliberate, reviewed act */
    it("matches the reviewed allowlist exactly", () => {
      const procedures = (
        appRouter as unknown as {
          _def: { procedures: Record<string, unknown> };
        }
      )._def.procedures;

      const publicPaths = Object.entries(procedures)
        .filter(([, procedure]) => isPublicProcedure(procedure))
        .map(([path]) => path)
        .sort();

      expect(publicPaths).toEqual([...PUBLIC_PROCEDURE_ALLOWLIST].sort());
    });

    /** @scenario Knowing a shared trace's id is not enough to read it */
    it("keeps the anonymous trace read down to the single share surface", () => {
      const shareLike = PUBLIC_PROCEDURE_ALLOWLIST.filter(
        (path) => path.includes("share") || path.includes("trace"),
      );
      expect(shareLike).toEqual(["sharedTrace.get"]);
    });
  });
});
