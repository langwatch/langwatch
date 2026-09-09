/**
 * @vitest-environment node
 * The signed-out front door: the procedures, the throttles, the refusals.
 * @see specs/auth/signup-does-not-strand-an-account.feature
 */
import { bindTrpcFact, callerAddressFact, createTrpcRuntime } from "@langwatch/api/trpc";
import { EmailAlreadyRegisteredError } from "@langwatch/user-contract";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { callerEmailFact, frontDoorTrpcTransport, type FrontDoorApi } from "../front-door.trpc.ts";
import { authTrpcTestPorts, type AuthTrpcTestContext } from "./auth.trpc.harness.ts";

const isWithinBudget = vi.fn<FrontDoorApi["isWithinBudget"]>();
const route = vi.fn<FrontDoorApi["route"]>();
const addressIsRegistered = vi.fn<FrontDoorApi["addressIsRegistered"]>();
const requestSignUpVerification = vi.fn<FrontDoorApi["requestSignUpVerification"]>();
const completeSignUpVerification = vi.fn<FrontDoorApi["completeSignUpVerification"]>();
const readInviteLanding = vi.fn<FrontDoorApi["readInviteLanding"]>();
const requestFreshInvite = vi.fn<FrontDoorApi["requestFreshInvite"]>();

const door: FrontDoorApi = {
  isWithinBudget,
  route,
  addressIsRegistered,
  requestSignUpVerification,
  completeSignUpVerification,
  readInviteLanding,
  requestFreshInvite,
};

const trpc = initTRPC.context<AuthTrpcTestContext>().create();
const router = createTrpcRuntime<AuthTrpcTestContext>({
  root: trpc,
  procedure: trpc.procedure,
  anonymousProcedure: trpc.procedure,
  ports: authTrpcTestPorts(),
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
    isWithinBudget.mockResolvedValue(true);
  });

  describe("given the mounted router", () => {
    it("publishes exactly the procedure names the signed-out screens call", () => {
      expect(Object.keys(router._def.procedures).sort()).toEqual([
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
      isWithinBudget.mockResolvedValue(false);

      await expect(
        visitor.route({ identifier: "ana@acme.com", breakGlass: undefined }),
      ).rejects.toThrow("Too many sign-in attempts. Please try again later.");
      expect(route).not.toHaveBeenCalled();
    });
  });

  describe("when a sign-up address already has an account", () => {
    it("says so rather than mailing a link, so nobody is stranded half-created", async () => {
      addressIsRegistered.mockResolvedValue(true);

      const refusal = await visitor
        .requestSignUpVerification({ email: "ana@acme.com" })
        .catch((err: unknown) => err);

      expect((refusal as { cause?: EmailAlreadyRegisteredError }).cause?.code).toBe(
        "email_already_registered",
      );
      expect(requestSignUpVerification).not.toHaveBeenCalled();
    });

    it("mails the link for an address that has none", async () => {
      addressIsRegistered.mockResolvedValue(false);

      await expect(
        visitor.requestSignUpVerification({ email: "ana@acme.com" }),
      ).resolves.toEqual({ sent: true });
      expect(requestSignUpVerification).toHaveBeenCalledWith(
        { session: null },
        { email: "ana@acme.com" },
      );
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
      expect(requestFreshInvite).toHaveBeenCalledWith({ session: null }, { inviteCode: "code-1" });
    });
  });

  describe("when a signed-in person asks for their own confirmation link", () => {
    const signedIn = () => router.createCaller({ actor: { id: "user_ana" }, email: "ana@acme.com" });

    it("mails the address the session named, keyed on the caller rather than their address", async () => {
      await expect(signedIn().sendMyAddressConfirmation({})).resolves.toEqual({ sent: true });

      expect(isWithinBudget).toHaveBeenCalledWith({
        key: "frontDoor.sendMyAddressConfirmation:user_ana",
        windowSeconds: 3600,
        max: 10,
      });
      expect(requestSignUpVerification).toHaveBeenCalledWith(
        { session: { user: { id: "user_ana", email: "ana@acme.com" } } },
        { email: "ana@acme.com" },
      );
    });

    it("refuses an account the process resolved no address for", async () => {
      const caller = router.createCaller({ actor: { id: "user_ana" }, email: null });

      await expect(caller.sendMyAddressConfirmation({})).rejects.toThrow(
        "This account has no email address to confirm.",
      );
      expect(requestSignUpVerification).not.toHaveBeenCalled();
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
