/**
 * @vitest-environment node
 * One offer about the account, two halves each on its own gate, one dismissal
 * for both (ADR-120, D06). Spec: specs/identity/passkeys.feature
 */
import { fromDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { MemoryUserCredentialRepository } from "../../repositories/memory/memory.user-signin-credential.repository.ts";
import { MemoryUserDatabase } from "../../repositories/memory/memory.user.database.ts";
import { MemoryUserRepository } from "../../repositories/memory/memory.user.repository.ts";
import { createUserTestApp, createUserTestAuth } from "./user.fixture.ts";

const DAY_MS = 24 * 60 * 60_000;
const NOW = new Date("2026-09-23T12:00:00Z");

async function offerFor({
  passkeys = true,
  twoStep = true,
  holdsPasskey = false,
  twoStepEnabled = false,
  dismissedDaysAgo = null,
  signedInWith = "password",
}: {
  passkeys?: boolean;
  twoStep?: boolean;
  holdsPasskey?: boolean;
  twoStepEnabled?: boolean;
  dismissedDaysAgo?: number | null;
  signedInWith?: "password" | "passkey" | "federated" | "unknown";
} = {}) {
  const database = MemoryUserDatabase.create();
  const users = MemoryUserRepository.create({ database });
  const { id } = await users.createCredentialUser({
    name: "Sam",
    email: "sam@acme.com",
    issuer: "local:credential",
    passwordHash: "hashed",
  });
  const row = database.user(id);
  if (!row) throw new Error("the user was not stored");
  database.writeUser({
    ...row,
    twoFactorEnabled: twoStepEnabled,
    passkeyNudgeDismissedAt:
      dismissedDaysAgo === null
        ? null
        : fromDate(new Date(NOW.getTime() - dismissedDaysAgo * DAY_MS)),
  });
  if (holdsPasskey) database.writePasskey({ id: "passkey-1", userId: id });

  const auth = Object.assign(createUserTestAuth(), {
    offersTwoStepVerification: vi.fn(() => twoStep),
    getSignedInWith: vi.fn(async () => signedInWith),
  });
  const app = createUserTestApp({
    repositories: { users, credentials: MemoryUserCredentialRepository.create({ database }) },
    dependencies: { auth },
    facts: { passkeysEnabled: passkeys, baseUrl: null },
    members: { now: () => fromDate(NOW) },
  });

  return { offer: await app.getPasskeyOffer({ id, sessionId: "session-1" }), auth };
}

describe("the account-security offer", () => {
  describe("given somebody who holds neither a passkey nor two-step verification", () => {
    /** @scenario "The offer covers whichever of the two the person lacks" */
    it("offers both, as one question about the account", async () => {
      const { offer } = await offerFor();

      expect(offer).toEqual({
        offer: true,
        passkey: true,
        twoStep: true,
        signedInWith: "password",
      });
    });
  });

  describe("given somebody who has set up two-step verification", () => {
    /** @scenario "Each half disappears once the person has it" */
    it("offers the passkey alone", async () => {
      const { offer } = await offerFor({ twoStepEnabled: true });

      expect(offer).toMatchObject({ offer: true, passkey: true, twoStep: false });
    });

    it("offers nothing once they hold a passkey as well", async () => {
      const { offer } = await offerFor({ twoStepEnabled: true, holdsPasskey: true });

      expect(offer).toMatchObject({ offer: false, passkey: false, twoStep: false });
    });
  });

  describe("given a deployment that offers passkeys and not two-step verification", () => {
    /** @scenario "Only what the deployment offers is offered" */
    it("offers the passkey alone", async () => {
      const { offer } = await offerFor({ twoStep: false });

      expect(offer).toMatchObject({ offer: true, passkey: true, twoStep: false });
    });
  });

  describe("given somebody who said not now", () => {
    /** @scenario "One dismissal answers the whole offer" */
    it("asks about neither the same day, and asks again after thirty days", async () => {
      await expect(offerFor({ dismissedDaysAgo: 0 })).resolves.toMatchObject({
        offer: { offer: false, passkey: true, twoStep: true },
      });
      await expect(offerFor({ dismissedDaysAgo: 31 })).resolves.toMatchObject({
        offer: { offer: true },
      });
    });
  });

  describe("given how this session signed in", () => {
    it("carries it, as the session recorded it, for the screen to decide on", async () => {
      const { offer, auth } = await offerFor({ signedInWith: "federated" });

      expect(offer.signedInWith).toBe("federated");
      expect(auth.getSignedInWith).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "session-1" }),
      );
    });
  });
});
