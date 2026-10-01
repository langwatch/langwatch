/**
 * @vitest-environment node
 * The signed-out front door: the procedures, the throttles, the refusals.
 * @see specs/auth/signup-does-not-strand-an-account.feature
 */
import { bindTrpcFact, callerAddressFact, createTrpcRuntime } from "@langwatch/api/trpc";
import {
  type FrontDoorRateLimitedError,
  type AuthApi,
  InvalidAuthOriginError,
  NoAddressToConfirmError,
} from "@langwatch/auth-contract";
import { EmailAlreadyRegisteredError } from "@langwatch/user-contract";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authRequestHeadersFact, authTrpcTransport, callerEmailFact } from "../auth.trpc.ts";
import { authTrpcTestMembers, type AuthTrpcTestContext } from "./auth.trpc.harness.ts";

const CHALLENGE = "c".repeat(43);
const isWithinBudget = vi.fn<AuthApi["isWithinBudget"]>();
const route = vi.fn<AuthApi["route"]>();
const addressIsRegistered = vi.fn<AuthApi["addressIsRegistered"]>();
const requestSignUpVerification = vi.fn<AuthApi["requestSignUpVerification"]>();
const assertSignUpOrigin = vi.fn<AuthApi["assertSignUpOrigin"]>();
const requestNewAccountVerification = vi.fn<AuthApi["requestNewAccountVerification"]>();
const sendMyAddressConfirmation = vi.fn<AuthApi["sendMyAddressConfirmation"]>();
const readInviteLanding = vi.fn<AuthApi["readInviteLanding"]>();
const requestFreshInvite = vi.fn<AuthApi["requestFreshInvite"]>();
const getSignUpEnrollment = vi.fn<AuthApi["getSignUpEnrollment"]>();
const getMyAddressConfirmation = vi.fn<AuthApi["getMyAddressConfirmation"]>();
const getPriorSession = vi.fn<AuthApi["getPriorSession"]>();

/** The seven operations this surface calls; the rest of the module refuses. */
const door: AuthApi = {
  countUsage: vi.fn(),
  countUsageForMembers: vi.fn(),
  offersPasskeys: () => false,
  offersTwoStepVerification: () => false,
  getSignedInWith: () => unreached("getSignedInWith"),
  findDialableIdentityProviderOrigins: () => unreached("findDialableIdentityProviderOrigins"),
  isWithinBudget,
  route,
  addressIsRegistered,
  requestSignUpVerification,
  assertSignUpOrigin,
  requestNewAccountVerification,
  sendMyAddressConfirmation,
  claimSignUpAddressProof: () => unreached("claimSignUpAddressProof"),
  claimUnconfirmedSignUpAddressProof: () => unreached("claimUnconfirmedSignUpAddressProof"),
  getSignUpEnrollment,
  getMyAddressConfirmation,
  getPriorSession,
  findSessionAmr: () => unreached("findSessionAmr"),
  findAssertedAmrForIdentifiers: () => unreached("findAssertedAmrForIdentifiers"),
  disableTwoStepVerification: () => unreached("disableTwoStepVerification"),
  linkProviderAccount: () => unreached("linkProviderAccount"),
  readInviteLanding,
  requestFreshInvite,
  resolveAuthProvider: () => unreached("resolveAuthProvider"),
  verifyBrowserSession: () => unreached("verifyBrowserSession"),
  resolveBrowserSession: () => unreached("resolveBrowserSession"),
  getCliAccessSession: () => unreached("getCliAccessSession"),
  issueProjectCliSession: () => unreached("issueProjectCliSession"),
  refreshCliSession: () => unreached("refreshCliSession"),
  findCliTokenRecordsForUser: () => unreached("findCliTokenRecordsForUser"),
  revokeCliTokens: () => unreached("revokeCliTokens"),
  listBrowserSessions: () => unreached("listBrowserSessions"),
  endBrowserSession: () => unreached("endBrowserSession"),
  endBrowserSessionsForIdentifier: () => unreached("endBrowserSessionsForIdentifier"),
  revokeAllBrowserSessions: () => unreached("revokeAllBrowserSessions"),
  revokeBrowserSession: () => unreached("revokeBrowserSession"),
  revokeOtherBrowserSessions: () => unreached("revokeOtherBrowserSessions"),
  retireLegacySsoAccess: () => unreached("retireLegacySsoAccess"),
  countLegacySsoAccess: () => unreached("countLegacySsoAccess"),
  findFederatedAccountProviders: () => unreached("findFederatedAccountProviders"),
  getSsoSetupStatus: () => unreached("getSsoSetupStatus"),
  issuesOwnPasswords: () => unreached("issuesOwnPasswords"),
  getSignInSecuritySettings: () => unreached("getSignInSecuritySettings"),
  saveSignInSecuritySettings: () => unreached("saveSignInSecuritySettings"),
  releaseHeldAccount: () => unreached("releaseHeldAccount"),
  changeFederatedPassword: () => unreached("changeFederatedPassword"),
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
}).mount(authTrpcTransport, () => door, {
  facts: [
    bindTrpcFact(callerAddressFact, (ctx) => ctx.address ?? null),
    bindTrpcFact(callerEmailFact, (ctx) => ctx.email ?? null),
    bindTrpcFact(authRequestHeadersFact, (ctx) => ctx.headers ?? null),
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
        "inviteLanding",
        "myAddressConfirmation",
        "priorSession",
        "requestFreshInvite",
        "requestSignUpVerification",
        "route",
        "sendMyAddressConfirmation",
        "signUpEnrollment",
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
        inviteLanding: "query",
        requestFreshInvite: "mutation",
        sendMyAddressConfirmation: "mutation",
        myAddressConfirmation: "query",
        signUpEnrollment: "mutation",
        priorSession: "query",
      });
    });
  });

  describe("when a signed-out visitor asks where an address signs in", () => {
    it("meters the attempt on the address the process resolved, not on the identifier", async () => {
      route.mockResolvedValue({
        outcome: "route_to_signup",
        methodSet: [],
        reasonCode: "identifier_unknown",
      });

      await visitor.route({ identifier: "ana@acme.com", breakGlass: undefined });

      expect(isWithinBudget).toHaveBeenCalledWith({
        key: "auth.route:203.0.113.7",
        windowSeconds: 3600,
        max: 200,
      });
      expect(route).toHaveBeenCalledWith({ identifier: "ana@acme.com", breakGlass: false });
    });

    it("spends one shared budget for every caller whose address the process could not resolve", async () => {
      route.mockResolvedValue({
        outcome: "route_to_signup",
        methodSet: [],
        reasonCode: "identifier_unknown",
      });

      await router.createCaller({}).route({ identifier: null, breakGlass: undefined });

      expect(isWithinBudget).toHaveBeenCalledWith({
        key: "auth.route:unknown",
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
      requestNewAccountVerification.mockResolvedValue({ sent: true });

      await expect(visitor.requestSignUpVerification({ email: "ana@acme.com" })).resolves.toEqual({
        sent: true,
      });
      expect(requestNewAccountVerification).toHaveBeenCalledWith({ email: "ana@acme.com" });
    });

    it("hands the screen the unconfirmed proof where no link could be sent", async () => {
      requestNewAccountVerification.mockResolvedValue({ sent: false, addressProof: "proof-1" });

      await expect(visitor.requestSignUpVerification({ email: "ana@acme.com" })).resolves.toEqual({
        sent: false,
        addressProof: "proof-1",
      });
    });
  });

  describe("when a sign-up starts on a web address the installation is not set up for", () => {
    /** @scenario "A sign-up started on a web address the installation is not set up for issues nothing" */
    it("refuses with the invalid origin code before mailing a link or issuing a proof", async () => {
      assertSignUpOrigin.mockRejectedValueOnce(new InvalidAuthOriginError());

      await expect(
        router
          .createCaller({ address: "203.0.113.7", headers: { origin: "http://localhost:18560" } })
          .requestSignUpVerification({ email: "sam@acme.com" }),
      ).rejects.toMatchObject({ cause: { code: "auth_invalid_origin" } });
      expect(assertSignUpOrigin).toHaveBeenCalledWith({
        origin: "http://localhost:18560",
        referer: null,
      });
      expect(requestNewAccountVerification).not.toHaveBeenCalled();
    });
  });

  describe("when one caller asks for confirmation link after confirmation link", () => {
    /** @scenario "Asking again and again for a confirmation link stops being answered" */
    it("refuses with the wait once the caller's hour is spent, and mails nothing", async () => {
      isWithinBudget.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 });

      await expect(
        visitor.requestSignUpVerification({ email: "someone-new@acme.com" }),
      ).rejects.toMatchObject({
        cause: { code: "auth_rate_limited", meta: { retryAfterSeconds: 120 } },
      });
      expect(isWithinBudget).toHaveBeenCalledWith({
        key: "auth.requestSignUpVerification:203.0.113.7",
        windowSeconds: 3600,
        max: 20,
      });
      expect(requestNewAccountVerification).not.toHaveBeenCalled();
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

      sendMyAddressConfirmation.mockResolvedValueOnce({ identifierId: "idf_own" });

      await expect(
        signedIn.sendMyAddressConfirmation({ codeChallenge: CHALLENGE }),
      ).resolves.toEqual({ sent: true, identifierId: "idf_own" });

      expect(sendMyAddressConfirmation).toHaveBeenCalledWith({
        actorId: "user_ana",
        email: "ana@acme.com",
        codeChallenge: CHALLENGE,
      });
    });

    it("hands over an account the process resolved no address for as having none", async () => {
      const caller = router.createCaller({ actor: { id: "user_ana" }, email: null });
      sendMyAddressConfirmation.mockRejectedValueOnce(new NoAddressToConfirmError());

      await expect(caller.sendMyAddressConfirmation({ codeChallenge: CHALLENGE })).rejects.toThrow(
        "This account has no email address to confirm.",
      );
      expect(sendMyAddressConfirmation).toHaveBeenCalledWith({
        actorId: "user_ana",
        email: null,
        codeChallenge: CHALLENGE,
      });
    });

    it("refuses a challenge that is not an S256 digest before reaching the app", async () => {
      const signedIn = router.createCaller({ actor: { id: "user_ana" }, email: "ana@acme.com" });

      await expect(
        signedIn.sendMyAddressConfirmation({ codeChallenge: "plain" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(sendMyAddressConfirmation).not.toHaveBeenCalled();
    });
  });

  describe("when a signed-in person asks whether their own address is confirmed", () => {
    it("asks about the address the session named, never one the caller typed", async () => {
      getMyAddressConfirmation.mockResolvedValueOnce({
        email: "ana@acme.com",
        confirmed: true,
        canSendConfirmation: true,
      });
      const signedIn = router.createCaller({ actor: { id: "user_ana" }, email: "ana@acme.com" });

      await expect(signedIn.myAddressConfirmation()).resolves.toEqual({
        email: "ana@acme.com",
        confirmed: true,
        canSendConfirmation: true,
      });
      expect(getMyAddressConfirmation).toHaveBeenCalledWith({ email: "ana@acme.com" });
    });
  });

  describe("when a visitor holding an address proof asks what they may enrol", () => {
    it("hands over the address and its proof, and answers the enrollment", async () => {
      getSignUpEnrollment.mockResolvedValueOnce({
        outcome: "enroll",
        methodSet: [{ id: "password", kind: "password", connectionId: null }],
        reasonCode: "no_domain_match",
      });

      await expect(
        visitor.signUpEnrollment({ email: "sam@example.com", addressProof: "proof-1" }),
      ).resolves.toMatchObject({ outcome: "enroll" });
      expect(getSignUpEnrollment).toHaveBeenCalledWith({
        email: "sam@example.com",
        addressProof: "proof-1",
      });
    });

    it("refuses a proof that does not hold, by its code", async () => {
      getSignUpEnrollment.mockRejectedValueOnce(new NoAddressToConfirmError());

      await expect(
        visitor.signUpEnrollment({ email: "sam@example.com", addressProof: "stale" }),
      ).rejects.toMatchObject({ cause: { code: "auth_no_address_to_confirm" } });
    });
  });

  describe("when a signed-out visitor asks why they are here", () => {
    it("hands the auth module the cookie the caller presented, and nothing they typed", async () => {
      getPriorSession.mockResolvedValue({ kind: "expired", email: "ana@acme.com" });

      await expect(
        router
          .createCaller({ headers: { cookie: "better-auth.session_token=tok.sig" } })
          .priorSession(),
      ).resolves.toEqual({ kind: "expired", email: "ana@acme.com" });

      const [call] = getPriorSession.mock.calls;
      expect(call?.[0].headers.get("cookie")).toBe("better-auth.session_token=tok.sig");
    });

    it("answers a request that arrived with no headers as a caller holding no cookie", async () => {
      getPriorSession.mockResolvedValue({ kind: "unknown" });

      await expect(router.createCaller({}).priorSession()).resolves.toEqual({ kind: "unknown" });
      expect(getPriorSession.mock.calls[0]?.[0].headers.get("cookie")).toBeNull();
    });
  });
});
