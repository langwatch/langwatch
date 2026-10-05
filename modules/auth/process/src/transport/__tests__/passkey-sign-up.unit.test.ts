import { beforeEach, describe, expect, it, vi } from "vitest";

import { BetterAuthAnnouncements } from "../../channels/better-auth.channel.ts";
import {
  PASSKEY_SIGNUP_ALREADY_SIGNED_IN,
  PASSKEY_SIGNUP_EMAIL_INVALID,
  PASSKEY_SIGNUP_EMAIL_TAKEN,
  PASSKEY_SIGNUP_RESTRICTED,
  PASSKEY_SIGNUP_VERIFICATION_REQUIRED,
  passkeySignUpRegistration,
  type PasskeyCeremonyCaller,
  type PasskeySignUpDirectory,
  type PasskeySignUpPolicy,
  type SignUpVerification,
} from "../../channels/http/http.passkey-sign-up.channel.ts";

/** Every write and spend, in the order it happened. */
const journal: string[] = [];
const createPasskeyUser = vi.fn(async ({ email }: { email: string }) => {
  journal.push(`create:${email}`);
  return { id: "user_1" };
});
const findByEmail = vi.fn();
const users: PasskeySignUpDirectory = { createPasskeyUser, findByEmail };

/** Live single-use proofs, keyed by token and bound to one address, as the token
 *  store keeps them. */
class ProofLedger implements SignUpVerification {
  readonly live = new Map<string, string>();

  async validateAddressProof({ token, email }: { token: string; email: string }) {
    return this.live.get(token) === email;
  }

  async claimAddressProof({ token, email }: { token: string; email: string }) {
    if (this.live.get(token) !== email) return false;
    this.live.delete(token);
    journal.push(`claim:${token}`);
    return true;
  }
}

const verification = new ProofLedger();

/** What the sign-up screen bakes into the challenge. */
const signUp = (email: string, addressProof = "proof_1") => JSON.stringify({ email, addressProof });

/** Records the announcements without letting one fail the ceremony. */
class SilentAnnouncements extends BetterAuthAnnouncements {
  readonly tracked: { userId: string; event: string }[] = [];

  trackServerEvent(input: { userId: string; event: string }): void {
    this.tracked.push({ userId: input.userId, event: input.event });
  }

  reportError(): void {}
  announceSignup(): void {}
  ssoAutoAddNurturing(): void {}
  sessionNurturing(): void {}
}

const announcements = new SilentAnnouncements();

/** A plugin context with just the pieces the callbacks touch. */
const fakeContext = () => {
  const createSession = vi.fn().mockResolvedValue({ id: "session_1" });
  const findUserById = vi.fn().mockResolvedValue({ id: "user_1" });
  return {
    // `createSession` is here to be asserted UNCALLED: the plugin opens the
    // session, inside the transaction, and a callback that opened its own
    // would make two for one ceremony.
    ctx: {
      context: { internalAdapter: { createSession, findUserById } },
    } as never,
    createSession,
  };
};

/** The installation's sign-up policy; open unless a test says otherwise. */
const checkSignUp = vi.fn<PasskeySignUpPolicy["checkSignUp"]>();

/** Who the ceremony's request is signed in as; nobody unless a test says otherwise. */
const signedInAs: { current: PasskeyCeremonyCaller } = { current: { signedIn: false } };

const registration = passkeySignUpRegistration({
  announcements,
  handleSecret: "test-secret",
  users,
  verification,
  policy: { checkSignUp },
  sessionOf: async () => signedInAs.current,
});
const resolveUser = registration.resolveUser;
const afterVerification = registration.afterVerification;

describe("given passkey sign-up, which creates an account with no session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    journal.length = 0;
    verification.live.clear();
    verification.live.set("proof_1", "someone@example.com");
    verification.live.set("proof_victim", "victim@corp.com");
    findByEmail.mockResolvedValue(null);
    checkSignUp.mockResolvedValue({ allowed: true, via: "open" });
    signedInAs.current = { signedIn: false };
  });

  describe("when the installation's sign-up policy refuses the address", () => {
    beforeEach(() => {
      checkSignUp.mockResolvedValue({ allowed: false, reason: "invite_only" });
    });

    /** @scenario "A refused passkey sign-up creates no account" */
    it("refuses to start the ceremony with the restricted code", async () => {
      await expect(
        resolveUser({ ctx: fakeContext().ctx, context: signUp("someone@example.com") }),
      ).rejects.toMatchObject({ body: { code: PASSKEY_SIGNUP_RESTRICTED } });
      expect(checkSignUp).toHaveBeenCalledWith({ email: "someone@example.com" });
    });

    /** @scenario "A refused passkey sign-up creates no account" */
    it("refuses after the ceremony too, spending no proof and writing no account", async () => {
      await expect(
        afterVerification({ ctx: fakeContext().ctx, context: signUp("someone@example.com") }),
      ).rejects.toMatchObject({ body: { code: PASSKEY_SIGNUP_RESTRICTED } });
      expect(journal).toEqual([]);
      expect(createPasskeyUser).not.toHaveBeenCalled();
    });

    it("does not answer a caller holding no valid address proof", async () => {
      await expect(
        resolveUser({
          ctx: fakeContext().ctx,
          context: signUp("someone@example.com", "proof_stale"),
        }),
      ).rejects.toMatchObject({ body: { code: PASSKEY_SIGNUP_VERIFICATION_REQUIRED } });
      expect(checkSignUp).not.toHaveBeenCalled();
    });
  });

  describe("when the address already has an account", () => {
    /**
     * The one that matters. Without it, dropping the session requirement from
     * the registration endpoints would let anybody attach their own passkey to
     * anybody else's account by naming the address — a total takeover with no
     * credential involved.
     */
    /** @scenario A passkey is never registered against an address that already has an account */
    /** @scenario "An address whose account can be signed into is still refused" */
    it("refuses to start a ceremony for somebody else's address", async () => {
      findByEmail.mockResolvedValue({ id: "someone_else" });

      await expect(
        resolveUser({ ctx: fakeContext().ctx, context: signUp("victim@corp.com", "proof_victim") }),
      ).rejects.toMatchObject({
        body: { code: PASSKEY_SIGNUP_EMAIL_TAKEN },
      });
    });

    it("refuses again after the ceremony, in case it was taken in between", async () => {
      const { ctx } = fakeContext();
      findByEmail.mockResolvedValue({ id: "someone_else" });

      await expect(
        afterVerification({ ctx, context: signUp("victim@corp.com", "proof_victim") }),
      ).rejects.toMatchObject({
        body: { code: PASSKEY_SIGNUP_EMAIL_TAKEN },
      });
      expect(createPasskeyUser).not.toHaveBeenCalled();
    });

    it("matches the address whatever case it was stored in", async () => {
      findByEmail.mockResolvedValue({ id: "someone_else" });

      await resolveUser({
        ctx: fakeContext().ctx,
        context: signUp("victim@corp.com", "proof_victim"),
      }).catch(() => void 0);

      expect(findByEmail).toHaveBeenCalledWith({ email: "victim@corp.com" });
    });
  });

  describe("when no address was carried at all", () => {
    it("refuses rather than minting a handle for nobody", async () => {
      await expect(resolveUser({ ctx: fakeContext().ctx, context: null })).rejects.toMatchObject({
        body: { code: PASSKEY_SIGNUP_EMAIL_INVALID },
      });
    });

    it("refuses something that is not an address", async () => {
      await expect(
        resolveUser({ ctx: fakeContext().ctx, context: "not-an-address" }),
      ).rejects.toMatchObject({
        body: { code: PASSKEY_SIGNUP_EMAIL_INVALID },
      });
    });
  });

  describe("when the address is free", () => {
    it("shows the address in the prompt, which is what a person recognises", async () => {
      const resolved = await resolveUser({
        ctx: fakeContext().ctx,
        context: signUp("Someone@Example.com"),
      });

      expect(resolved.name).toBe("someone@example.com");
      expect(resolved.displayName).toBe("someone@example.com");
    });

    it("hands the authenticator a handle that is not the address", async () => {
      const resolved = await resolveUser({
        ctx: fakeContext().ctx,
        context: signUp("someone@example.com"),
      });

      expect(resolved.id).not.toContain("someone");
      expect(resolved.id).not.toContain("@");
    });

    it("hands back the same handle every time, so a retry replaces the credential", async () => {
      const first = await resolveUser({
        ctx: fakeContext().ctx,
        context: signUp("someone@example.com"),
      });
      const second = await resolveUser({
        ctx: fakeContext().ctx,
        context: signUp("someone@example.com"),
      });

      expect(first.id).toBe(second.id);
    });

    it("creates nothing merely for being asked", async () => {
      await resolveUser({
        ctx: fakeContext().ctx,
        context: signUp("someone@example.com"),
      });

      expect(createPasskeyUser).not.toHaveBeenCalled();
    });
  });

  describe("when the ceremony has succeeded", () => {
    it("creates the account for the address the ceremony was started with", async () => {
      const { ctx } = fakeContext();

      await afterVerification({ ctx, context: signUp("Someone@Example.com") });

      expect(createPasskeyUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: "someone@example.com" }),
      );
    });

    it("attaches the passkey to the account rather than to the handle", async () => {
      const { ctx } = fakeContext();

      const result = await afterVerification({
        ctx,
        context: signUp("someone@example.com"),
      });

      expect(result.userId).toBe("user_1");
    });

    /**
     * The plugin mints the session, inside the transaction this callback runs
     * in — so the callback must NOT open one of its own. Two sessions for one
     * ceremony is the bug this pins: the hand-rolled mint that predated
     * better-auth 1.7 would now run beside the plugin's.
     */
    /** @scenario Signing up with a passkey creates the account and the session together */
    it("leaves the session to the transaction that writes the credential", async () => {
      const { ctx, createSession } = fakeContext();

      const result = await afterVerification({
        ctx,
        context: signUp("someone@example.com"),
      });

      expect(createSession).not.toHaveBeenCalled();
      // The account it hands back is what the plugin mints the session for.
      expect(result.userId).toBe("user_1");
    });

    /** @scenario Signing up with a passkey consumes the verified address proof */
    it("spends the address proof before it writes the account", async () => {
      const { ctx } = fakeContext();

      await afterVerification({ ctx, context: signUp("someone@example.com") });

      expect(journal).toEqual(["claim:proof_1", "create:someone@example.com"]);
      expect(verification.live.has("proof_1")).toBe(false);
    });
  });

  describe("when the proof it carries is not live", () => {
    it("refuses to start a ceremony for a proof that belongs to another address", async () => {
      await expect(
        resolveUser({
          ctx: fakeContext().ctx,
          context: signUp("someone@example.com", "proof_victim"),
        }),
      ).rejects.toMatchObject({ body: { code: PASSKEY_SIGNUP_VERIFICATION_REQUIRED } });
      expect(verification.live.has("proof_victim")).toBe(true);
    });

    /** @scenario A spent mailbox proof cannot start a second enrollment */
    it("refuses a second enrollment with a proof already spent, creating nothing", async () => {
      const { ctx } = fakeContext();
      await afterVerification({ ctx, context: signUp("someone@example.com") });
      createPasskeyUser.mockClear();

      await expect(
        afterVerification({ ctx, context: signUp("someone@example.com") }),
      ).rejects.toMatchObject({ body: { code: PASSKEY_SIGNUP_VERIFICATION_REQUIRED } });
      expect(createPasskeyUser).not.toHaveBeenCalled();
    });

    it("refuses a ceremony that carries no proof at all", async () => {
      await expect(
        resolveUser({
          ctx: fakeContext().ctx,
          context: JSON.stringify({ email: "someone@example.com" }),
        }),
      ).rejects.toMatchObject({ body: { code: PASSKEY_SIGNUP_EMAIL_INVALID } });
    });
  });

  describe("when the ceremony runs for somebody already signed in", () => {
    beforeEach(() => {
      signedInAs.current = { signedIn: true, user: { id: "user_sam", email: "sam@acme.com" } };
    });

    /** @scenario Adding a passkey while signed in attaches it to that account */
    it("attaches the passkey to that account and creates nothing", async () => {
      const result = await afterVerification({ ctx: fakeContext().ctx, context: null });

      expect(result).toEqual({ userId: "user_sam", name: "sam@acme.com" });
      expect(createPasskeyUser).not.toHaveBeenCalled();
      expect(journal).toEqual([]);
    });

    /** @scenario A signed-in browser cannot sign up a different address's passkey */
    it("refuses a sign-up ceremony for another address, creating nothing", async () => {
      await expect(
        afterVerification({ ctx: fakeContext().ctx, context: signUp("someone@example.com") }),
      ).rejects.toMatchObject({ body: { code: PASSKEY_SIGNUP_ALREADY_SIGNED_IN } });
      expect(createPasskeyUser).not.toHaveBeenCalled();
      expect(journal).toEqual([]);
    });
  });
});
