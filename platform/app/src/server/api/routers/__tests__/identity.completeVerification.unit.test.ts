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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { identityRouter } from "../identity";

const { mockComplete } = vi.hoisted(() => ({
  mockComplete: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));

// The router reaches the runtime for the ceremony; the module graph behind
// it (auth -> better-auth) reaches the same module for the hooks, so the
// whole composition root is stubbed rather than a slice of it.
vi.mock("~/server/app-layer/identity/runtime", () => ({
  verificationCeremony: () => ({ completeEmailVerification: mockComplete }),
  identityCeremonies: () => ({
    beforeAccountCreate: async () => undefined,
    beforeAccountDelete: async () => undefined,
    beforeUserDelete: async () => undefined,
  }),
  identityEmail: () => ({ resolveEmail: async () => null }),
  isLatched: async () => false,
}));

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
