/**
 * @vitest-environment node
 *
 * The identity tRPC surface (D01). Every operation acts on the CALLER'S OWN
 * identity, so the session is the whole credential and no permission check
 * applies: what this pins is that the session user - never an input field -
 * is what reaches the ceremony, that a signed-out caller is refused before
 * the ceremony runs, and that a refusal keeps its handled code.
 *
 * Corresponds to specs/identity/identifier-model.feature.
 */
import { IdentityVerificationInvalidError } from "@langwatch/identity";
import type { TRPCError } from "@trpc/server";
import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as IdentityRuntime from "~/server/app-layer/identity/runtime";
import { createInnerTRPCContext } from "../../trpc";
import { identityRouter } from "../identity";

const { mockComplete } = vi.hoisted(() => ({
  mockComplete: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));

/**
 * The router reaches the runtime for the ceremony; the module graph behind
 * it (auth -> better-auth) reaches the same module for the hooks and for
 * better-auth's whole `database:` entry, so the composition root is stubbed
 * WHOLE rather than a slice of it.
 *
 * The return type is what keeps it whole. A missing export is a module-load
 * crash ("No X export is defined on the mock") that only shows up in the
 * suite that happens to trip it; typed as the runtime's own key set, the
 * same drift is a typecheck failure on this file instead. The VALUES stay
 * deliberately partial — each stub answers only what this suite drives.
 */
/**
 * The tRPC mutation pipeline audits every mutation, and the audit writer
 * reaches Prisma — which in a unit test is a connection refusal, not a
 * behaviour. Stubbed the way every other audited router suite stubs it; the
 * audit trail's own content is not this suite's claim.
 */
vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock(
  "~/server/app-layer/identity/runtime",
  (): Record<keyof typeof IdentityRuntime, unknown> => ({
    verificationCeremony: () => ({ completeEmailVerification: mockComplete }),
    identityCeremonies: () => ({
      beforeAccountCreate: async () => undefined,
      beforeAccountDelete: async () => undefined,
      beforeUserDelete: async () => undefined,
    }),
    identityEmail: () => ({ resolveEmail: async () => null }),
    identityService: () => ({}),
    identityGuards: () => ({}),
    identityProjectionStore: () => ({}),
    twoStepAccount: () => ({}),
    identityBridgeCeremonies: () => ({
      beforeAccountCreate: async () => undefined,
      beforeAccountDelete: async () => undefined,
    }),
    identityBackfill: () => ({}),
    identifierBackfillMigration: () => ({}),
    identityBirth: () => ({}),
    identityNewbornReconciliation: () => ({}),
    identitySecretCarry: () => ({}),
    identitySecretHealMigration: () => ({}),
    isLatched: async () => false,
    isAnyoneLatched: async () => false,
    // A value, not a factory: the runtime exports the birth-aware gate itself
    // so the adapter and the databaseHooks bridge fork on one closure.
    routesToIdentityBranch: async () => false,
    // `betterAuth()` builds its adapter EAGERLY at module load, so this one
    // has to be real enough to initialise. better-auth's own memory engine
    // over an empty store is exactly that, and it holds nothing this suite
    // could accidentally assert against.
    identityStorageAdapter: () => memoryAdapter({}),
    // The rest of the runtime's surface, named because the mock's own return
    // type is `Record<keyof typeof IdentityRuntime, unknown>` — a new export
    // that is not listed here fails the typecheck rather than silently
    // resolving to `undefined` at the call site. None of these are reached:
    // this suite calls `completeEmailVerification` and nothing else, so they
    // stay inert rather than being modelled.
    connectionGrandfatherMigration: () => ({}),
    joinRequests: () => ({}),
    joinRequestsService: () => ({}),
    // These two are re-exported from ./signin-method-policy rather than built
    // here, so they are the functions themselves, not factories returning one.
    deploymentIsFederationCapable: () => false,
    resolveSignInMethodPolicy: async () => ({}),
    // Re-stated by the runtime because it is better-auth's one identity door.
    // Nothing in this suite asks it; the Record above is exhaustive.
    looksLikeSsoConnectionId: () => false,
    signInDomainRoutingPort: () => ({}),
    signInRouter: () => ({}),
    signUpIdentifier: () => ({}),
    signUpVerification: () => ({}),
    ssoConnections: () => ({}),
    // Wave 3's additions. Stubbed rather than omitted because the annotation
    // above is exhaustive on purpose: a new runtime export has to be looked
    // at here, and this suite reaches none of them.
    BACKUP_CODE_COUNT: 0,
    accountIdentifiers: () => ({}),
    memberProvenance: () => ({}),
    mfaCeremonies: () => ({}),
    mfaEnrollments: () => ({}),
    organizationMfa: () => ({}),
    sessionClaims: () => ({}),
    sessionInventory: () => ({}),
    signUpHealth: () => ({}),
    ssoBreakGlass: () => ({}),
    ssoDomainClaimQueue: () => ({}),
    ssoDomainReproof: () => ({}),
    ssoEngineProviderDerivation: () => ({}),
    ssoSelfServe: () => ({}),
    // ADR-129 slice 21a: better-auth's own composition-root reads, now
    // exhaustive on this Record too. Nothing in this suite reaches either.
    secondaryStorage: () => ({ configured: false, connection: () => null }),
    betterAuthInstance: () => ({ provide: () => undefined }),
    // ADR-129 slice 21b: the three satellite roots folded into the runtime.
    identityLookup: () => ({}),
    linkProposals: () => ({}),
    scimOversight: () => ({}),
    scimReconciliation: () => ({}),
    twoStepVerification: () => ({}),
    PASSWORD_HASH_ROUNDS: 10,
    sessionRevocation: () => ({}),
    ssoRegisteredIssuers: () => ({}),
    signUpConfirmationEndpoint: () => ({}),
    passwordResetSessionBridge: () => ({}),
    passkeySignUp: () => ({}),
    bornFinalizedOptIn: () => ({}),
    lastWayIn: () => ({}),
    lastWayInGuard: () => ({}),
    credentialAccounts: () => ({}),
    ssoAssertion: () => ({}),
    ssoArrival: () => ({}),
    databaseHooks: () => ({}),
    sessionMinter: () => ({}),
  }),
);

/** A syntactically valid RFC 7636 verifier (43-128 unreserved characters). */
const VERIFIER = "a".repeat(43);

const input = {
  identifierId: "idf_work",
  verificationId: "verif_1",
  token: "tok_raw",
  codeVerifier: VERIFIER,
};

function callerFor(session: { user: { id: string; email: string } } | null) {
  const ctx = createInnerTRPCContext({
    session: session ? { ...session, expires: "1" } : null,
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  return identityRouter.createCaller(ctx);
}

describe("identity.completeVerification", () => {
  beforeEach(() => {
    mockComplete.mockReset();
    mockComplete.mockResolvedValue(undefined);
  });

  describe("when a signed-in caller presents both proofs", () => {
    /** @scenario "Email verification completes only with the ceremony's proof" */
    it("completes for the SESSION user, never a user named in the input", async () => {
      const caller = callerFor({
        user: { id: "user_sam", email: "sam@acme.com" },
      });

      await expect(
        caller.completeVerification({
          ...input,
          userId: "user_mallory",
        } as never),
      ).resolves.toEqual({ verified: true });

      expect(mockComplete).toHaveBeenCalledWith({
        userId: "user_sam",
        identifierId: "idf_work",
        verificationId: "verif_1",
        token: "tok_raw",
        codeVerifier: VERIFIER,
      });
    });
  });

  describe("when the caller holds no session", () => {
    it("refuses before the ceremony runs", async () => {
      const caller = callerFor(null);

      await expect(caller.completeVerification(input)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      } satisfies Partial<TRPCError>);
      expect(mockComplete).not.toHaveBeenCalled();
    });
  });

  describe("when the code verifier is not RFC 7636 syntax", () => {
    it("is rejected at the boundary, before the ceremony runs", async () => {
      const caller = callerFor({
        user: { id: "user_sam", email: "sam@acme.com" },
      });

      await expect(
        caller.completeVerification({ ...input, codeVerifier: "too-short" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(mockComplete).not.toHaveBeenCalled();
    });
  });

  describe("when the ceremony refuses the proof", () => {
    it("keeps the handled code rather than degrading to unknown", async () => {
      mockComplete.mockRejectedValue(new IdentityVerificationInvalidError());
      const caller = callerFor({
        user: { id: "user_sam", email: "sam@acme.com" },
      });

      await expect(caller.completeVerification(input)).rejects.toMatchObject({
        message: "identity_verification_invalid",
      });
    });
  });
});
