/**
 * @vitest-environment node
 * The signed-out front door: the procedures, the throttles, the refusals.
 * @see specs/auth/signup-does-not-strand-an-account.feature
 */
import { bindTrpcFact, callerAddressFact, createTrpcRuntime } from "@langwatch/api/trpc";
import {
  type FrontDoorRateLimitedError,
  type AuthApi,
  NoAddressToConfirmError,
} from "@langwatch/auth-contract";
import { EmailAlreadyRegisteredError } from "@langwatch/user-contract";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { callerEmailFact, frontDoorTrpcTransport } from "../front-door.trpc.ts";
import { authTrpcTestMembers, type AuthTrpcTestContext } from "./auth.trpc.harness.ts";

const isWithinBudget = vi.fn<AuthApi["isWithinBudget"]>();
const route = vi.fn<AuthApi["route"]>();
const addressIsRegistered = vi.fn<AuthApi["addressIsRegistered"]>();
const requestSignUpVerification = vi.fn<AuthApi["requestSignUpVerification"]>();
const requestNewAccountVerification = vi.fn<AuthApi["requestNewAccountVerification"]>();
const sendMyAddressConfirmation = vi.fn<AuthApi["sendMyAddressConfirmation"]>();
const completeSignUpVerification = vi.fn<AuthApi["completeSignUpVerification"]>();
const readInviteLanding = vi.fn<AuthApi["readInviteLanding"]>();
const requestFreshInvite = vi.fn<AuthApi["requestFreshInvite"]>();

/** The seven operations this surface calls; the rest of the module refuses. */
const door: AuthApi = {
  countUsage: vi.fn(),
  offersPasskeys: () => false,
  offersTwoStepVerification: () => false,
  getSignedInWith: () => unreached("getSignedInWith"),
  findDialableIdentityProviderOrigins: () => unreached("findDialableIdentityProviderOrigins"),
  isWithinBudget,
  route,
  addressIsRegistered,
  requestSignUpVerification,
  requestNewAccountVerification,
  sendMyAddressConfirmation,
  completeSignUpVerification,
  readInviteLanding,
  requestFreshInvite,
  resolveAuthProvider: () => unreached("resolveAuthProvider"),
  tryVerifyBrowserSession: () => unreached("tryVerifyBrowserSession"),
  tryResolveBrowserSession: () => unreached("tryResolveBrowserSession"),
  findCliAccessSession: () => unreached("findCliAccessSession"),
  revokeCliAccessToken: () => unreached("revokeCliAccessToken"),
  listBrowserSessions: () => unreached("listBrowserSessions"),
  endBrowserSession: () => unreached("endBrowserSession"),
  revokeAllBrowserSessions: () => unreached("revokeAllBrowserSessions"),
  revokeBrowserSession: () => unreached("revokeBrowserSession"),
  revokeOtherBrowserSessions: () => unreached("revokeOtherBrowserSessions"),
  retireLegacySsoAccess: () => unreached("retireLegacySsoAccess"),
  countLegacySsoAccess: () => unreached("countLegacySsoAccess"),
  findFederatedAccountProviders: () => unreached("findFederatedAccountProviders"),
  issuesOwnPasswords: () => unreached("issuesOwnPasswords"),
  getSignInSecuritySettings: () => unreached("getSignInSecuritySettings"),
  saveSignInSecuritySettings: () => unreached("saveSignInSecuritySettings"),
  releaseHeldAccount: () => unreached("releaseHeldAccount"),
};

/** The front door reaches no session operation: naming one here would be a bug. */
function unreached(operation: string): never {
  throw new Error(`the front door called ${operation}`);
}

const trpc = initTRPC.context<AuthTrpcTestContext>().create();
const router = createTrpcRuntime<AuthTrpcTestContext>({
  root: trpc,
  procedure: trpc.procedure,
  anonymousProcedure: trpc.procedure,
  members: authTrpcTestMembers(),
}).mount(frontDoorTrpcTransport, () => door, {
  facts: [
    bindTrpcFact(callerAddressFact, (ctx) => ctx.address ?? null),
    bindTrpcFact(callerEmailFact, (ctx) => ctx.email ?? null),
  ],
});

const visitor = router.createCaller({ address: "203.0.113.7" });

describe("the signed-out front door", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isWithinBudget.mockResolvedValue({ allowed: true });
  });

  describe("given the mounted router", () => {
    it("publishes exactly the procedure names the signed-out screens call", () => {
      expect(Object.keys(router._def.procedures).toSorted()).toEqual([
        "completeSignUpVerification",
        "inviteLanding",
        "requestFreshInvite",
        "requestSignUpVerification",
        "route",
        "sendMyAddressConfirmation",
      ]);
    });

    it("reads the invitation with a query and writes with everything else", () => {
      const kinds = Object.fromEntries(
        Object.entries(router._def.procedures).map(([name, procedure]) => [
          name,
          (procedure as { _def: { type: string } })._def.type,
        ]),
      );

      expect(kinds).toEqual({
        route: "mutation",
        requestSignUpVerification: "mutation",
        completeSignUpVerification: "mutation",
        inviteLanding: "query",
        requestFreshInvite: "mutation",
        sendMyAddressConfirmation: "mutation",
      });
    });
  });

  describe("when a signed-out visitor asks where an address signs in", () => {
    it("meters the attempt on the address the process resolved, not on the identifier", async () => {
      route.mockResolvedValue({ kind: "email" } as never);

      await visitor.route({ identifier: "ana@acme.com", breakGlass: undefined });

      expect(isWithinBudget).toHaveBeenCalledWith({
        key: "frontDoor.route:203.0.113.7",
        windowSeconds: 3600,
        max: 200,
      });
      expect(route).toHaveBeenCalledWith({ identifier: "ana@acme.com", breakGlass: false });
    });

    it("spends one shared budget for every caller whose address the process could not resolve", async () => {
      route.mockResolvedValue({ kind: "email" } as never);

      await router.createCaller({}).route({ identifier: null, breakGlass: undefined });

      expect(isWithinBudget).toHaveBeenCalledWith({
        key: "frontDoor.route:unknown",
        windowSeconds: 3600,
        max: 200,
      });
    });

    it("refuses past the budget rather than asking the router again", async () => {
      isWithinBudget.mockResolvedValue({ allowed: false });

      await expect(
        visitor.route({ identifier: "ana@acme.com", breakGlass: undefined }),
      ).rejects.toThrow("Too many sign-in attempts. Please try again later.");
      expect(route).not.toHaveBeenCalled();
    });

    /** @scenario A throttled door says how long the wait is */
    it("refuses with the throttle's own code, never as an absent collaborator", async () => {
      isWithinBudget.mockResolvedValue({ allowed: false, retryAfterSeconds: 90 });

      const refusal = await visitor
        .route({ identifier: "ana@acme.com", breakGlass: undefined })
        .catch((error: unknown) => error);

      expect((refusal as { cause?: FrontDoorRateLimitedError }).cause?.code).toBe(
        "auth_rate_limited",
      );
    });

    /** @scenario A throttled door says how long the wait is */
    it("carries the seconds to wait, which is what names the minutes", async () => {
      isWithinBudget.mockResolvedValue({ allowed: false, retryAfterSeconds: 90 });

      const refusal = await visitor
        .route({ identifier: "ana@acme.com", breakGlass: undefined })
        .catch((error: unknown) => error);

      expect((refusal as { cause?: FrontDoorRateLimitedError }).cause?.meta).toMatchObject({
        retryAfterSeconds: 90,
      });
    });
  });

  describe("when a sign-up address already has an account", () => {
    it("says so rather than mailing a link, so nobody is stranded half-created", async () => {
      requestNewAccountVerification.mockRejectedValueOnce(new EmailAlreadyRegisteredError());

      const refusal = await visitor
        .requestSignUpVerification({ email: "ana@acme.com" })
        .catch((err: unknown) => err);

      expect((refusal as { cause?: EmailAlreadyRegisteredError }).cause?.code).toBe(
        "email_already_registered",
      );
    });

    it("asks for a new account's link for the address the visitor typed", async () => {
      requestNewAccountVerification.mockResolvedValue(undefined);

      await expect(visitor.requestSignUpVerification({ email: "ana@acme.com" })).resolves.toEqual({
        sent: true,
      });
      expect(requestNewAccountVerification).toHaveBeenCalledWith({ email: "ana@acme.com" });
    });
  });

  describe("when a visitor opens an invitation link", () => {
    it("answers what the landing page may say, and nothing that names a person", async () => {
      readInviteLanding.mockResolvedValue({
        organizationName: "Acme",
        inviterName: "Ana",
        alreadyAccepted: false,
      });

      await expect(visitor.inviteLanding({ inviteCode: "code-1" })).resolves.toEqual({
        organizationName: "Acme",
        inviterName: "Ana",
        alreadyAccepted: false,
      });
    });

    it("mints nothing when the holder of a stale code asks for another", async () => {
      requestFreshInvite.mockResolvedValue(undefined);

      await expect(visitor.requestFreshInvite({ inviteCode: "code-1" })).resolves.toEqual({
        asked: true,
      });
      expect(requestFreshInvite).toHaveBeenCalledWith({ inviteCode: "code-1" });
    });
  });

  describe("when a signed-in person asks for their own confirmation link", () => {
    it("hands over the caller and the address the session named, never one the caller typed", async () => {
      const signedIn = router.createCaller({ actor: { id: "user_ana" }, email: "ana@acme.com" });

      await expect(signedIn.sendMyAddressConfirmation({})).resolves.toEqual({ sent: true });

      expect(sendMyAddressConfirmation).toHaveBeenCalledWith({
        actorId: "user_ana",
        email: "ana@acme.com",
      });
    });

    it("hands over an account the process resolved no address for as having none", async () => {
      const caller = router.createCaller({ actor: { id: "user_ana" }, email: null });
      sendMyAddressConfirmation.mockRejectedValueOnce(new NoAddressToConfirmError());

      await expect(caller.sendMyAddressConfirmation({})).rejects.toThrow(
        "This account has no email address to confirm.",
      );
      expect(sendMyAddressConfirmation).toHaveBeenCalledWith({ actorId: "user_ana", email: null });
    });
  });

  describe("when a confirmation link is spent", () => {
    it("answers the address it confirmed and what spending it made", async () => {
      completeSignUpVerification.mockResolvedValue({
        email: "ana@acme.com",
        accountCreated: true,
        accountExists: false,
      });

      await expect(visitor.completeSignUpVerification({ token: "tok" })).resolves.toEqual({
        email: "ana@acme.com",
        accountCreated: true,
        accountExists: false,
      });
    });
  });
});
