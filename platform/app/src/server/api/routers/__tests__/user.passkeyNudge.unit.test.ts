/**
 * Whether the passkey nudge is offered at all (ADR-120).
 *
 * Spec: specs/identity/passkeys.feature
 *
 * The nudge offers a way IN, and only the identifier-first screens accept a
 * passkey — so mounting the plugin is not enough to ask: a deployment still
 * signing everybody in on the legacy screens must stay silent, or it walks
 * people into minting a credential the sign-in screen has no button for.
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
  } as Record<string, string>,
}));
vi.mock("../../../../env.mjs", () => envState);

vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

describe("userRouter.passkeyNudge", () => {
  let passkeyCount: ReturnType<typeof vi.fn>;
  let userFindUnique: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    envState.env.PASSKEYS_ENABLED = "on";
    envState.env.IDENTITY_ROUTER_V2 = "off";
    passkeyCount = vi.fn().mockResolvedValue(0);
    userFindUnique = vi
      .fn()
      .mockResolvedValue({ passkeyNudgeDismissedAt: null });
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
    return userRouter.createCaller(ctx).passkeyNudge({});
  };

  describe("given passkeys are minted but the legacy screens are the way in", () => {
    /** @scenario The nudge stays silent while the old sign-in screens are the way in */
    it("offers nothing while the identifier-first screens are off", async () => {
      envState.env.IDENTITY_ROUTER_V2 = "off";

      await expect(call()).resolves.toEqual({ offer: false });
      // Decided from deployment shape alone — nobody's account is read to
      // reach an answer that cannot depend on it.
      expect(passkeyCount).not.toHaveBeenCalled();
    });

    /** @scenario The nudge stays silent while the old sign-in screens are the way in */
    it("offers nothing in shadow, which changes nothing a person can see", async () => {
      envState.env.IDENTITY_ROUTER_V2 = "shadow";

      await expect(call()).resolves.toEqual({ offer: false });
    });
  });

  describe("given the identifier-first screens are enforced", () => {
    it("offers a passkey to somebody holding none who was never asked", async () => {
      envState.env.IDENTITY_ROUTER_V2 = "enforce";

      await expect(call()).resolves.toEqual({ offer: true });
    });

    it("still offers nothing when the plugin itself is off", async () => {
      envState.env.IDENTITY_ROUTER_V2 = "enforce";
      envState.env.PASSKEYS_ENABLED = "off";

      await expect(call()).resolves.toEqual({ offer: false });
    });
  });
});
