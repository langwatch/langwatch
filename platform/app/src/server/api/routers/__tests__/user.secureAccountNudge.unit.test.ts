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
    PASSKEYS_ENABLED: "on",
    IDENTITY_ROUTER_V2: "off",
    MFA_ENROLLMENT_OPEN: "off",
  } as Record<string, string>,
}));
vi.mock("../../../../env.mjs", () => envState);

vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

describe("userRouter.secureAccountNudge", () => {
  let passkeyCount: ReturnType<typeof vi.fn>;
  let userFindUnique: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    envState.env.PASSKEYS_ENABLED = "on";
    envState.env.IDENTITY_ROUTER_V2 = "off";
    envState.env.MFA_ENROLLMENT_OPEN = "off";
    passkeyCount = vi.fn().mockResolvedValue(0);
    userFindUnique = vi.fn().mockResolvedValue({
      passkeyNudgeDismissedAt: null,
      twoFactorEnabled: false,
    });
  });

  const call = () => {
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "user-1", email: "sam@acme.com" },
        sessionId: "sess-1",
        expires: "2099-01-01",
      },
    });
    (ctx as any).prisma = {
      passkey: { count: passkeyCount },
      user: { findUnique: userFindUnique },
    };
    return userRouter.createCaller(ctx).secureAccountNudge({});
  };

  describe("given passkeys are minted but the legacy screens are the way in", () => {
    /** @scenario The nudge stays silent while the old sign-in screens are the way in */
    it("offers nothing while the identifier-first screens are off", async () => {
      envState.env.IDENTITY_ROUTER_V2 = "off";

      await expect(call()).resolves.toEqual({
        offer: false,
        passkey: false,
        twoStep: false,
      });
      // Decided from deployment shape alone — nobody's account is read to
      // reach an answer that cannot depend on it.
      expect(passkeyCount).not.toHaveBeenCalled();
      expect(userFindUnique).not.toHaveBeenCalled();
    });

    /** @scenario The nudge stays silent while the old sign-in screens are the way in */
    it("offers nothing in shadow, which changes nothing a person can see", async () => {
      envState.env.IDENTITY_ROUTER_V2 = "shadow";

      await expect(call()).resolves.toMatchObject({ offer: false });
    });
  });

  describe("given the identifier-first screens are enforced", () => {
    it("offers a passkey to somebody holding none who was never asked", async () => {
      envState.env.IDENTITY_ROUTER_V2 = "enforce";

      await expect(call()).resolves.toEqual({
        offer: true,
        passkey: true,
        twoStep: false,
      });
    });

    it("offers nothing to somebody who already holds one", async () => {
      envState.env.IDENTITY_ROUTER_V2 = "enforce";
      passkeyCount.mockResolvedValue(1);

      await expect(call()).resolves.toMatchObject({
        offer: false,
        passkey: false,
      });
    });

    it("still offers nothing when the plugin itself is off", async () => {
      envState.env.IDENTITY_ROUTER_V2 = "enforce";
      envState.env.PASSKEYS_ENABLED = "off";

      await expect(call()).resolves.toEqual({
        offer: false,
        passkey: false,
        twoStep: false,
      });
    });
  });

  describe("given two-step verification is offered on this deployment", () => {
    beforeEach(() => {
      envState.env.MFA_ENROLLMENT_OPEN = "on";
    });

    /** @scenario "Only what the deployment offers is offered" */
    it("offers it to somebody who has not set one up", async () => {
      envState.env.PASSKEYS_ENABLED = "off";

      await expect(call()).resolves.toEqual({
        offer: true,
        passkey: false,
        twoStep: true,
      });
    });

    /** @scenario "Each half disappears once the person has it" */
    it("offers nothing to somebody who already has one", async () => {
      envState.env.PASSKEYS_ENABLED = "off";
      userFindUnique.mockResolvedValue({
        passkeyNudgeDismissedAt: null,
        twoFactorEnabled: true,
      });

      await expect(call()).resolves.toEqual({
        offer: false,
        passkey: false,
        twoStep: false,
      });
    });

    /** @scenario "The offer covers whichever of the two the person lacks" */
    it("offers both halves at once to somebody who has neither", async () => {
      envState.env.IDENTITY_ROUTER_V2 = "enforce";

      await expect(call()).resolves.toEqual({
        offer: true,
        passkey: true,
        twoStep: true,
      });
    });
  });

  describe("given somebody who has said not now", () => {
    beforeEach(() => {
      envState.env.IDENTITY_ROUTER_V2 = "enforce";
      envState.env.MFA_ENROLLMENT_OPEN = "on";
    });

    /** @scenario "One dismissal answers the whole offer" */
    it("stays silent about BOTH halves, not only the one they declined", async () => {
      userFindUnique.mockResolvedValue({
        passkeyNudgeDismissedAt: new Date(),
        twoFactorEnabled: false,
      });

      await expect(call()).resolves.toMatchObject({ offer: false });
    });

    it("asks again once the interval has passed", async () => {
      userFindUnique.mockResolvedValue({
        passkeyNudgeDismissedAt: new Date(
          Date.now() - 31 * 24 * 60 * 60 * 1000,
        ),
        twoFactorEnabled: false,
      });

      await expect(call()).resolves.toMatchObject({ offer: true });
    });
  });
});
