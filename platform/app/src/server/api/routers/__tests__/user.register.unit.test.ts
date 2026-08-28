/**
 * Unit tests for userRouter.register.
 *
 * Covers the PostHog signed_up milestone, and the ADR-027 provider coercion:
 * see specs/licensing/sso-license-gating.feature. The signup page registers
 * through this tRPC mutation (not better-auth's /sign-up/email), so the
 * email-mode coercion must apply here too: on a denied SSO-capable deployment
 * the resolved provider is "email" and registration must work, while a
 * licensed SSO deployment keeps refusing direct registration.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { userRouter } from "../user";

// The raw env names an IdP; what this route keys off is the RESOLVED provider
// below, so the two can disagree and that is the point of the coercion tests.
vi.mock("../../../../env.mjs", () => ({
  env: { NEXTAUTH_PROVIDER: "auth0", BASE_HOST: "http://localhost:5560" },
}));

const { mockTrackServerEvent } = vi.hoisted(() => ({
  mockTrackServerEvent: vi.fn(),
}));

vi.mock("~/server/posthog", () => ({
  trackServerEvent: mockTrackServerEvent,
}));

vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

// The tRPC error-audit middleware writes through the real prisma singleton, so
// a mutation that throws here reaches a live client and fails with a Prisma
// validation error that masks the assertion. Shard-order dependent: on its own
// this file passes, batched with a test that initializes the app singleton it
// does not.
vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/utils/getClientIp", () => ({
  getDirectPeerIp: vi.fn(() => "127.0.0.1"),
}));

const { resolveAuthProviderMock } = vi.hoisted(() => ({
  resolveAuthProviderMock: vi.fn(),
}));
const { requestVerificationMock } = vi.hoisted(() => ({
  requestVerificationMock: vi.fn(),
}));
const { attachCredentialIdentifierMock } = vi.hoisted(() => ({
  attachCredentialIdentifierMock: vi.fn(),
}));

// The account-creating call is what sends the confirmation link, so the
// service it sends through is the seam this suite drives. Its other two
// methods answer "no proof was carried in", which is the plain sign-up path.
vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  signUpIdentifier: () => ({
    attachCredentialIdentifier: attachCredentialIdentifierMock,
  }),
  signUpVerification: () => ({
    claimAddressProof: vi.fn().mockResolvedValue(null),
    markAddressConfirmed: vi.fn().mockResolvedValue(undefined),
    requestVerification: requestVerificationMock,
  }),
}));

vi.mock("@ee/sso/sso-gate", () => ({
  resolveAuthProvider: resolveAuthProviderMock,
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    skipPermissionCheck: ({ ctx, next }: any) => {
      ctx.permissionChecked = true;
      return next();
    },
  };
});

describe("userRouter.register()", () => {
  let userFindFirstMock: ReturnType<typeof vi.fn>;
  let userCreateMock: ReturnType<typeof vi.fn>;
  let accountCreateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    userFindFirstMock = vi.fn().mockResolvedValue(null);
    userCreateMock = vi
      .fn()
      .mockResolvedValue({ id: "user-1", name: "Alice", email: "a@x.com" });
    accountCreateMock = vi.fn().mockResolvedValue({
      id: "account-1",
      createdAt: new Date("2026-08-28T00:00:00.000Z"),
    });
    // Most cases here are the coerced/email-mode deployment; the licensed-SSO
    // case overrides this.
    resolveAuthProviderMock.mockResolvedValue("email");
    attachCredentialIdentifierMock.mockResolvedValue(undefined);
    requestVerificationMock.mockResolvedValue(undefined);
  });

  const createCaller = () => {
    const ctx = createInnerTRPCContext({ session: null });
    const prismaMock = {
      user: { findFirst: userFindFirstMock, create: userCreateMock },
      account: { create: accountCreateMock },
      $transaction: vi.fn(
        async (cb: (tx: unknown) => unknown) =>
          await cb({
            user: { create: userCreateMock },
            account: { create: accountCreateMock },
          }),
      ),
    };
    (ctx as any).prisma = prismaMock;
    return userRouter.createCaller(ctx);
  };

  describe("when registration succeeds", () => {
    /** @scenario Email-mode registration tracks the PostHog signed_up milestone exactly once */
    it("tracks the signed_up analytics event with the new user id", async () => {
      const result = await createCaller().register({
        name: "Alice",
        email: "a@x.com",
        password: "supersecret",
      });

      expect(result).toEqual({ id: "user-1" });
      expect(mockTrackServerEvent).toHaveBeenCalledTimes(1);
      expect(mockTrackServerEvent).toHaveBeenCalledWith({
        userId: "user-1",
        event: "signed_up",
      });
      expect(attachCredentialIdentifierMock).toHaveBeenCalledWith({
        userId: "user-1",
        email: "a@x.com",
        accountId: "account-1",
        occurredAtMs: new Date("2026-08-28T00:00:00.000Z").getTime(),
      });
    });
  });

  describe("when the email is typed with capital letters", () => {
    /**
     * Sign-in goes through BetterAuth, which lowercases the address on every
     * lookup, so an account stored as typed is one sign-in can never find:
     * the customer is locked out with "User already exists" forever.
     */
    /** @scenario "A capitalised email creates an account sign-in can find" */
    it("stores the canonically normalized address", async () => {
      await createCaller().register({
        name: "Joel",
        email: "Joel.During@example.com",
        password: "supersecret",
      });

      expect(userCreateMock).toHaveBeenCalledWith({
        data: { name: "Joel", email: "joel.during@example.com" },
      });
      expect(attachCredentialIdentifierMock).toHaveBeenCalledWith({
        userId: "user-1",
        email: "joel.during@example.com",
        accountId: "account-1",
        occurredAtMs: new Date("2026-08-28T00:00:00.000Z").getTime(),
      });
    });

    /** @scenario "A capitalised email creates an account sign-in can find" */
    it("finds an existing account regardless of its stored casing", async () => {
      userFindFirstMock.mockResolvedValue({ id: "user-1" });

      await expect(
        createCaller().register({
          name: "Joel",
          email: "Joel.During@example.com",
          password: "supersecret",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect(userFindFirstMock).toHaveBeenCalledWith({
        where: {
          email: { equals: "joel.during@example.com", mode: "insensitive" },
        },
      });
      expect(userCreateMock).not.toHaveBeenCalled();
    });
  });

  describe("when the user already exists", () => {
    /** @scenario A rejected registration tracks no PostHog signed_up milestone */
    it("does not track signed_up", async () => {
      userFindFirstMock.mockResolvedValue({ id: "user-1" });

      // The refusal is the handled email_already_registered error (the signup
      // screen keys its recovery flow off this code), surfaced through tRPC
      // with the CONFLICT transport code its 409 maps to.
      await expect(
        createCaller().register({
          name: "Alice",
          email: "a@x.com",
          password: "supersecret",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      expect(mockTrackServerEvent).not.toHaveBeenCalled();
    });
  });

  describe("given an SSO-capable deployment where the gate DENIES (coerced email mode)", () => {
    /** @scenario A fresh unlicensed deployment bootstraps via email signup */
    it("registers the user through the signup form's tRPC path", async () => {
      resolveAuthProviderMock.mockResolvedValue("email");

      await expect(
        createCaller().register({
          name: "Operator",
          email: "operator@example.com",
          password: "password-123",
        }),
      ).resolves.toMatchObject({ id: "user-1" });
      expect(userCreateMock).toHaveBeenCalled();
    });
  });

  describe("given an SSO-capable deployment where the gate ALLOWS", () => {
    /** @scenario A licensed deployment cannot mint password accounts */
    it("refuses direct registration", async () => {
      resolveAuthProviderMock.mockResolvedValue("auth0");

      await expect(
        createCaller().register({
          name: "Attacker",
          email: "attacker@example.com",
          password: "password-123",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(userCreateMock).not.toHaveBeenCalled();
    });
  });

  describe("when the account has just been created", () => {
    /** @scenario "The confirmation link is sent by the call that creates the account" */
    it("sends the link to the address the account was created for", async () => {
      const caller = createCaller();

      await caller.register({
        email: "sam@acme.com",
        password: "correct horse battery staple",
        name: "Sam",
      });

      // Not from the screen, which holds no session to send from, and not
      // from a public "mail this address" endpoint, which would be a mailer
      // pointed at anything anybody types.
      expect(requestVerificationMock).toHaveBeenCalledWith({
        email: "sam@acme.com",
      });
    });

    /** @scenario "The confirmation link is sent by the call that creates the account" */
    it("keeps the account when the mailer is down", async () => {
      requestVerificationMock.mockRejectedValue(new Error("smtp unreachable"));
      const caller = createCaller();

      // The account exists and the way on is the "send it again" the next
      // screen offers; losing the registration over a mail failure would cost
      // somebody the account they just made.
      await expect(
        caller.register({
          email: "sam@acme.com",
          password: "correct horse battery staple",
          name: "Sam",
        }),
      ).resolves.toEqual({ id: "user-1" });
    });
  });
});
