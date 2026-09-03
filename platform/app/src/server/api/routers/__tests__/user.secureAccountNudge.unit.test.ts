/**
 * What the "secure your account" nudge offers, and when it stays silent
 * (ADR-120, extended at D06).
 *
 * Spec: specs/identity/passkeys.feature, specs/identity/mfa-and-session-shape.feature
 *
 * One offer, two halves, each with its own gate. The passkey half offers a
 * way IN, and only the identifier-first screens accept a passkey — so
 * mounting the plugin is not enough to ask: a deployment still signing
 * everybody in on the legacy screens must stay silent, or it walks people
 * into minting a credential the sign-in screen has no button for. The
 * two-step half is gated on its own flag, and with both off nothing is read
 * at all.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { userRouter } from "../user";

const envState = vi.hoisted(() => ({
  env: {
    NEXTAUTH_PROVIDER: "email",
    BASE_HOST: "http://localhost:5560",
    MFA_ENROLLMENT_OPEN: "off",
  } as Record<string, string>,
}));
vi.mock("../../../../env.mjs", () => envState);

vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

const { secureAccountFactsMock } = vi.hoisted(() => ({
  secureAccountFactsMock: vi.fn(),
}));
// What the offer is decided FROM is the credential service's read; what the
// offer IS stays the router's decision, and that is what these assert.
vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  credentialAccounts: () => ({ secureAccountFacts: secureAccountFactsMock }),
}));

describe("userRouter.secureAccountNudge", () => {
  /** What the account holds, as the credential service reads it back. */
  const held: {
    passkeys: number;
    twoStepEnabled: boolean;
    nudgeDismissedAt: Date | null;
  } = { passkeys: 0, twoStepEnabled: false, nudgeDismissedAt: null };

  beforeEach(() => {
    vi.clearAllMocks();
    envState.env.MFA_ENROLLMENT_OPEN = "off";
    held.passkeys = 0;
    held.twoStepEnabled = false;
    held.nudgeDismissedAt = null;
    secureAccountFactsMock.mockImplementation(async () => ({ ...held }));
  });

  const call = (signedInWith?: "password" | "passkey" | "federated") => {
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "user-1", email: "sam@acme.com" },
        sessionId: "sess-1",
        expires: "2099-01-01",
        ...(signedInWith ? { signedInWith } : {}),
      },
    });
    return userRouter.createCaller(ctx).secureAccountNudge({});
  };

  describe("given somebody who signs in with a password alone", () => {
    it("offers a passkey to somebody holding none who was never asked", async () => {
      await expect(call("password")).resolves.toEqual({
        offer: true,
        passkey: true,
        twoStep: false,
        signedInWith: "password",
      });
    });

    it("offers nothing to somebody who already holds one", async () => {
      held.passkeys = 1;

      await expect(call()).resolves.toMatchObject({
        offer: false,
        passkey: false,
      });
    });
  });

  describe("given two-step verification is offered on this deployment", () => {
    beforeEach(() => {
      envState.env.MFA_ENROLLMENT_OPEN = "on";
      // Holding a passkey already, so the passkey half is settled and what
      // these assertions read is the two-step half on its own.
      held.passkeys = 1;
    });

    /** @scenario "Only what the deployment offers is offered" */
    it("offers it to somebody who has not set one up", async () => {
      await expect(call("password")).resolves.toEqual({
        offer: true,
        passkey: false,
        twoStep: true,
        signedInWith: "password",
      });
    });

    /** @scenario "Each half disappears once the person has it" */
    it("offers nothing to somebody who already has one", async () => {
      held.twoStepEnabled = true;

      await expect(call("password")).resolves.toEqual({
        offer: false,
        passkey: false,
        twoStep: false,
        signedInWith: "password",
      });
    });

    /** @scenario "The offer covers whichever of the two the person lacks" */
    it("offers both halves at once to somebody who has neither", async () => {
      held.passkeys = 0;

      await expect(call("password")).resolves.toEqual({
        offer: true,
        passkey: true,
        twoStep: true,
        signedInWith: "password",
      });
    });
  });

  describe("given somebody who has said not now", () => {
    beforeEach(() => {
      envState.env.MFA_ENROLLMENT_OPEN = "on";
    });

    /** @scenario "One dismissal answers the whole offer" */
    it("stays silent about BOTH halves, not only the one they declined", async () => {
      held.nudgeDismissedAt = new Date();

      await expect(call()).resolves.toMatchObject({ offer: false });
    });

    it("asks again once the interval has passed", async () => {
      held.nudgeDismissedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

      await expect(call()).resolves.toMatchObject({ offer: true });
    });
  });

  describe("given the offer is about to be drawn", () => {
    /** @scenario "The passkey offer follows a password, not a federated sign-in" */
    it("reports how the session was signed in, so the offer can follow a password", async () => {
      await expect(call("federated")).resolves.toMatchObject({
        signedInWith: "federated",
      });
      await expect(call("passkey")).resolves.toMatchObject({
        signedInWith: "passkey",
      });
    });

    /** @scenario "The passkey offer follows a password, not a federated sign-in" */
    it("reports a session that recorded no method as unknown rather than as a password", async () => {
      await expect(call()).resolves.toMatchObject({ signedInWith: "unknown" });
    });
  });
});
