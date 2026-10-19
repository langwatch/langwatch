/**
 * @vitest-environment node
 * @see specs/auth/azure-ad-account-upgrade.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import {
  type AccountKeyMove,
  IdentityAccountRekeyRepository,
} from "../../repositories/identity-account-rekey.repository.ts";
import { MemoryIdentityAccountRekeyRepository } from "../../repositories/memory/memory.identity-account-rekey.repository.ts";
import { MemoryIdentityStore } from "../../repositories/memory/memory.identity.store.ts";
import { LEGACY_MICROSOFT_ISSUER } from "../../rules/microsoft-account-key-move.rules.ts";
import { MicrosoftAccountRekeyService } from "../microsoft-account-rekey.service.ts";

const ISSUER = "https://login.microsoftonline.com/3f2504e0-4f89-11d3-9a0c-0305e82c3301/v2.0";
const token = { sub: "pairwise-sub", oid: "object-id", iss: ISSUER };

class FailingRekeyRepository extends IdentityAccountRekeyRepository {
  readonly asked: AccountKeyMove[] = [];

  async moveLegacyMicrosoftAccount(move: AccountKeyMove): Promise<never> {
    this.asked.push(move);
    throw new Error("connection terminated");
  }
}

function legacyStore(): MemoryIdentityStore {
  const store = MemoryIdentityStore.create();
  store.accounts.set("user-1", [
    {
      id: "acc-microsoft",
      provider: "microsoft",
      issuer: LEGACY_MICROSOFT_ISSUER,
      providerAccountId: "pairwise-sub",
      createdAtMs: 0,
    },
  ]);
  return store;
}

describe("MicrosoftAccountRekeyService", () => {
  describe("when the account is still on its pre-3.17 key", () => {
    it("moves it onto the token's issuer and oid, and leaves it there on the next sign-in", async () => {
      const store = legacyStore();
      const { logger } = createTestLogger();
      const service = MicrosoftAccountRekeyService.create({
        accounts: MemoryIdentityAccountRekeyRepository.create(store),
        logger,
      });

      await service.moveOnSignIn({ profile: token });
      await service.moveOnSignIn({ profile: token });

      expect(store.accounts.get("user-1")).toEqual([
        expect.objectContaining({ issuer: ISSUER, providerAccountId: "object-id" }),
      ]);
    });
  });

  describe("when the move fails", () => {
    /** @scenario "A sign-in whose account move fails is stopped instead of reaching account linking" */
    it("propagates the failure so the sign-in stops", async () => {
      const accounts = new FailingRekeyRepository();
      const { logger } = createTestLogger();
      const service = MicrosoftAccountRekeyService.create({ accounts, logger });

      await expect(service.moveOnSignIn({ profile: token })).rejects.toThrow(
        "connection terminated",
      );
      expect(accounts.asked).toHaveLength(1);
    });
  });

  describe("when the token asks for no move", () => {
    it("proceeds without touching the rows", async () => {
      const accounts = new FailingRekeyRepository();
      const { logger } = createTestLogger();
      const service = MicrosoftAccountRekeyService.create({ accounts, logger });

      await expect(
        service.moveOnSignIn({ profile: { ...token, oid: undefined } }),
      ).resolves.toBeUndefined();
      expect(accounts.asked).toEqual([]);
    });
  });
});
