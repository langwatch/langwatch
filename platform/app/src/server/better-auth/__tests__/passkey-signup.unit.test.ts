import { beforeEach, describe, expect, it, vi } from "vitest";

// The composition root, which the module's thin exports reach for and these
// cases do not: the registration under test is constructed here, over
// in-memory stand-ins for its three collaborators.
vi.mock("~/server/app-layer/identity/runtime", () => ({
  passkeySignUp: vi.fn(),
}));

// The session read that tells "somebody is adding a passkey to the account
// they are signed into" apart from "somebody is creating one". `APIError` is
// kept REAL: every refusal below is asserted by the code it carries, and a
// stand-in would only assert the stand-in.
const getSessionFromCtx = vi.fn();
vi.mock("better-auth/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("better-auth/api")>()),
  getSessionFromCtx: (...args: unknown[]) => getSessionFromCtx(...args),
}));

import { PasskeySignUpAddressTakenError } from "~/server/users/credential-user";
import {
  PASSKEY_SIGNUP_EMAIL_INVALID,
  PASSKEY_SIGNUP_EMAIL_TAKEN,
  PasskeySignUpRegistration,
} from "../passkey-signup";

/**
 * The three boundaries the registration reaches for: the directory it asks
 * "does this address have an account", the writer that creates one, and the
 * mailer the confirmation follows through. The predicate that reads the
 * directory's answer (`belongsToSomebody`) is REAL — it is the contract this
 * guard and the write share, and mocking it would leave the two halves of it
 * unasserted against each other.
 */
const findAddressHolder = vi.fn();
const createPasskeyUser = vi.fn();
const requestVerification = vi.fn();

const registration = () =>
  new PasskeySignUpRegistration({
    directory: { findAddressHolder },
    accounts: { createPasskeyUser },
    verification: { requestVerification },
  });

const resolveUser = (args: { ctx: never; context?: string | null }) =>
  registration().resolveUser(args);

const afterVerification = (args: { ctx: never; context?: string | null }) =>
  registration().afterVerification(args);

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

/**
 * An account somebody can actually sign into — the shape the guard refuses.
 * A password is the least interesting way to hold a credential and the
 * easiest to write down; the passkey and identity-provider variants are
 * exercised separately below.
 */
const signable = (id: string) => ({
  id,
  accounts: [{ provider: "credential", password: "argon2id$..." }],
  accountCredentials: [],
  passkeys: [],
  orgMemberships: [],
});

/**
 * The residue of a ceremony that died between writing the account and
 * writing the passkey: the placeholder credential row, holding no password,
 * and nothing else. Nobody has ever signed into this and nobody could.
 */
const stranded = (id: string) => ({
  id,
  accounts: [{ provider: "credential", password: null }],
  accountCredentials: [],
  passkeys: [],
  orgMemberships: [],
});

describe("given passkey sign-up, which creates an account with no session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findAddressHolder.mockResolvedValue(null);
    createPasskeyUser.mockResolvedValue({ id: "user_1", created: true });
    requestVerification.mockResolvedValue(void 0);
    // Nobody signed in, which is the case this whole block is about.
    getSessionFromCtx.mockResolvedValue(null);
  });

  describe("when the address already has an account", () => {
    /**
     * The one that matters. Without it, dropping the session requirement from
     * the registration endpoints would let anybody attach their own passkey to
     * anybody else's account by naming the address — a total takeover with no
     * credential involved.
     */
    /** @scenario A passkey is never registered against an address that already has an account */
    it("refuses to start a ceremony for somebody else's address", async () => {
      findAddressHolder.mockResolvedValue(signable("someone_else"));

      await expect(
        resolveUser({ ctx: fakeContext().ctx, context: "victim@corp.com" }),
      ).rejects.toMatchObject({
        body: { code: PASSKEY_SIGNUP_EMAIL_TAKEN },
      });
    });

    it("refuses again after the ceremony, in case it was taken in between", async () => {
      const { ctx } = fakeContext();
      findAddressHolder.mockResolvedValue(signable("someone_else"));

      await expect(
        afterVerification({ ctx, context: "victim@corp.com" }),
      ).rejects.toMatchObject({ body: { code: PASSKEY_SIGNUP_EMAIL_TAKEN } });
      expect(createPasskeyUser).not.toHaveBeenCalled();
    });

    /**
     * Asked of the directory by address. Matching it whatever case the row was
     * written in is that repository's rule, and the layering guard is what
     * keeps it from being re-spelled at this boundary.
     */
    it("asks the directory for the normalized address", async () => {
      findAddressHolder.mockResolvedValue(signable("someone_else"));

      await resolveUser({
        ctx: fakeContext().ctx,
        context: "Victim@Corp.com",
      }).catch(() => void 0);

      expect(findAddressHolder).toHaveBeenCalledWith({
        email: "victim@corp.com",
      });
    });
  });

  /**
   * The guard has to tell two things apart that used to look identical: an
   * account, and the wreckage of a ceremony that never made one. Both are a
   * User row for the address. Only one of them is somebody's.
   */
  describe("when the address has an account nobody can sign into", () => {
    /** @scenario A sign-up that died mid-ceremony leaves the address usable */
    it("lets the ceremony start again rather than calling the address taken", async () => {
      findAddressHolder.mockResolvedValue(stranded("half_made"));

      const resolved = await resolveUser({
        ctx: fakeContext().ctx,
        context: "someone@example.com",
      });

      expect(resolved.name).toBe("someone@example.com");
    });

    /** @scenario A sign-up that died mid-ceremony leaves the address usable */
    it("finishes onto the row the first attempt left behind", async () => {
      const { ctx } = fakeContext();
      findAddressHolder.mockResolvedValue(stranded("half_made"));
      createPasskeyUser.mockResolvedValue({ id: "half_made", created: false });

      const result = await afterVerification({
        ctx,
        context: "someone@example.com",
      });

      expect(result.userId).toBe("half_made");
    });

    /**
     * The placeholder is the only credential row that means nothing. A passkey
     * beside it means the first attempt DID finish, and the address is taken
     * in the way that matters — this is the boundary the takeover guard now
     * sits on, so it is asserted from both sides.
     */
    /** @scenario An address whose account can be signed into is still refused */
    it("refuses once a passkey has landed against it", async () => {
      findAddressHolder.mockResolvedValue({
        ...stranded("finished"),
        passkeys: [{ id: "passkey_1" }],
      });

      await expect(
        resolveUser({ ctx: fakeContext().ctx, context: "victim@corp.com" }),
      ).rejects.toMatchObject({ body: { code: PASSKEY_SIGNUP_EMAIL_TAKEN } });
    });

    /**
     * An empty password opens nothing, so it is not a credential — the same
     * reading `LastWayInService` takes when it decides whether removing a
     * passkey would strand somebody. If the two disagreed, a row one of them
     * called a way in the other would call residue, and the address would
     * stay burned for precisely the account with no way into it.
     */
    it("treats an empty password as no credential at all", async () => {
      findAddressHolder.mockResolvedValue({
        ...stranded("empty_password"),
        accounts: [{ provider: "credential", password: "" }],
      });

      const resolved = await resolveUser({
        ctx: fakeContext().ctx,
        context: "someone@example.com",
      });

      expect(resolved.name).toBe("someone@example.com");
    });

    /**
     * Belt and braces on the security boundary. Nothing today makes a
     * credential-less user who belongs to an organization — joining takes a
     * sign-in, and this account has never had a way to attempt one — so this
     * refuses no real recovery. It stops the predicate's safety resting on an
     * argument about code elsewhere, which is the part that decays.
     */
    it("refuses an account that belongs to an organization regardless", async () => {
      findAddressHolder.mockResolvedValue({
        ...stranded("member"),
        orgMemberships: [{ organizationId: "org_1" }],
      });

      await expect(
        resolveUser({ ctx: fakeContext().ctx, context: "victim@corp.com" }),
      ).rejects.toMatchObject({ body: { code: PASSKEY_SIGNUP_EMAIL_TAKEN } });
    });

    /**
     * The guard runs before the transaction opens, so between them the
     * address can stop being residue. The write re-decides it where the read
     * and the write cannot be pulled apart, and the refusal has to reach the
     * screen in the same vocabulary the earlier one would have — otherwise
     * losing that race looks like a broken ceremony rather than a taken
     * address.
     */
    it("answers a claim that lands mid-write as a taken address", async () => {
      const { ctx } = fakeContext();
      findAddressHolder.mockResolvedValue(stranded("half_made"));
      createPasskeyUser.mockRejectedValue(
        new PasskeySignUpAddressTakenError("claimed mid-write"),
      );

      await expect(
        afterVerification({ ctx, context: "someone@example.com" }),
      ).rejects.toMatchObject({ body: { code: PASSKEY_SIGNUP_EMAIL_TAKEN } });
    });

    it("refuses an account that signs in through an identity provider", async () => {
      findAddressHolder.mockResolvedValue({
        ...stranded("sso_user"),
        accounts: [{ provider: "okta", password: null }],
      });

      await expect(
        resolveUser({ ctx: fakeContext().ctx, context: "victim@corp.com" }),
      ).rejects.toMatchObject({ body: { code: PASSKEY_SIGNUP_EMAIL_TAKEN } });
    });

    /**
     * A user whose backfill has finalized keeps their credential on the
     * identity branch instead. Reading only `Account` would have called every
     * one of them unregistered — the failure mode this half of the predicate
     * exists to prevent, and the one worth pinning because the population it
     * would have exposed grows every time the migration finalizes somebody.
     */
    it("refuses an account whose credential lives on the identity branch", async () => {
      findAddressHolder.mockResolvedValue({
        ...stranded("latched_user"),
        accounts: [],
        accountCredentials: [
          { provider: "credential", password: "argon2id$..." },
        ],
      });

      await expect(
        resolveUser({ ctx: fakeContext().ctx, context: "victim@corp.com" }),
      ).rejects.toMatchObject({ body: { code: PASSKEY_SIGNUP_EMAIL_TAKEN } });
    });
  });

  describe("when no address was carried at all", () => {
    it("refuses rather than minting a handle for nobody", async () => {
      await expect(
        resolveUser({ ctx: fakeContext().ctx, context: null }),
      ).rejects.toMatchObject({
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
        context: "Someone@Example.com",
      });

      expect(resolved.name).toBe("someone@example.com");
      expect(resolved.displayName).toBe("someone@example.com");
    });

    it("hands the authenticator a handle that is not the address", async () => {
      const resolved = await resolveUser({
        ctx: fakeContext().ctx,
        context: "someone@example.com",
      });

      expect(resolved.id).not.toContain("someone");
      expect(resolved.id).not.toContain("@");
    });

    it("hands back the same handle every time, so a retry replaces the credential", async () => {
      const first = await resolveUser({
        ctx: fakeContext().ctx,
        context: "someone@example.com",
      });
      const second = await resolveUser({
        ctx: fakeContext().ctx,
        context: "someone@example.com",
      });

      expect(first.id).toBe(second.id);
    });

    it("creates nothing merely for being asked", async () => {
      await resolveUser({
        ctx: fakeContext().ctx,
        context: "someone@example.com",
      });

      expect(createPasskeyUser).not.toHaveBeenCalled();
    });
  });

  describe("when the ceremony has succeeded", () => {
    it("creates the account for the address the ceremony was started with", async () => {
      const { ctx } = fakeContext();

      await afterVerification({ ctx, context: "Someone@Example.com" });

      expect(createPasskeyUser).toHaveBeenCalledWith({
        email: "someone@example.com",
      });
    });

    it("attaches the passkey to the account rather than to the handle", async () => {
      const { ctx } = fakeContext();

      const result = await afterVerification({
        ctx,
        context: "someone@example.com",
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
        context: "someone@example.com",
      });

      expect(createSession).not.toHaveBeenCalled();
      // The account it hands back is what the plugin mints the session for.
      expect(result.userId).toBe("user_1");
    });

    it("sends the address confirmation after them, not in front of them", async () => {
      const { ctx } = fakeContext();

      await afterVerification({ ctx, context: "someone@example.com" });

      expect(requestVerification).toHaveBeenCalledWith({
        email: "someone@example.com",
      });
    });

    it("finishes the sign-up even when the mailer is down", async () => {
      const { ctx } = fakeContext();
      requestVerification.mockRejectedValue(new Error("mailer unreachable"));

      await expect(
        afterVerification({ ctx, context: "someone@example.com" }),
      ).resolves.toMatchObject({ userId: "user_1" });
    });
  });
});

/**
 * The other caller of the same two endpoints, and the one the sign-up shape
 * broke: a reader who is already signed in, adding a passkey from Settings,
 * from the secure-account nudge, or from the offer after a password reset.
 *
 * The plugin resolves such a caller from their session and never calls
 * `resolveUser` — but it calls `afterVerification` regardless of how the user
 * was resolved. So the sign-up callback has to recognise them itself, which
 * is what these hold it to.
 */
describe("given somebody who is already signed in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findAddressHolder.mockResolvedValue(null);
    createPasskeyUser.mockResolvedValue({ id: "user_1", created: true });
    requestVerification.mockResolvedValue(void 0);
    getSessionFromCtx.mockResolvedValue({
      user: { id: "signed_in_user", email: "sergio+test@langwatch.ai" },
    });
  });

  describe("when they add a passkey without a context", () => {
    /**
     * The settings page calls `addPasskey({})`, so no `context` reaches the
     * endpoint. Reading one anyway refused the ceremony they had just
     * completed with "Enter an email address to create an account", on a page
     * displaying the very address it said was missing.
     */
    /** @scenario Adding a passkey while signed in attaches it to that account */
    it("attaches the passkey to the account they are signed into", async () => {
      const { ctx } = fakeContext();

      await expect(afterVerification({ ctx, context: null })).resolves.toEqual({
        userId: "signed_in_user",
        name: "sergio+test@langwatch.ai",
      });
    });

    it("does not refuse them for having no address to create an account with", async () => {
      const { ctx } = fakeContext();

      await expect(
        afterVerification({ ctx, context: undefined }),
      ).resolves.toMatchObject({ userId: "signed_in_user" });
    });

    /**
     * The consequence worse than the message: with an address in hand the
     * sign-up path would have written a SECOND account for somebody who is
     * already signed into one.
     */
    it("creates no second account for them", async () => {
      const { ctx } = fakeContext();

      await afterVerification({ ctx, context: "sergio+test@langwatch.ai" });

      expect(createPasskeyUser).not.toHaveBeenCalled();
    });

    it("sends them no address confirmation, because they are not signing up", async () => {
      const { ctx } = fakeContext();

      await afterVerification({ ctx, context: null });

      expect(requestVerification).not.toHaveBeenCalled();
    });

    it("opens no session of its own, because they already hold one", async () => {
      const { ctx, createSession } = fakeContext();

      await afterVerification({ ctx, context: null });

      expect(createSession).not.toHaveBeenCalled();
    });
  });
});
