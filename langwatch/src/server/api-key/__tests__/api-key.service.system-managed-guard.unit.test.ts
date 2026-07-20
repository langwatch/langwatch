/**
 * System-managed API keys — today the ephemeral "Langy session" key, one per
 * chat session with a 6h TTL — are minted and retired by the product.
 *
 * The repository already filtered them out of every listing, but absence is
 * not immutability: `update` and `revoke` load by id and never consulted
 * HIDDEN_SYSTEM_KEY_NAMES, so a caller holding an id could rename one or
 * revoke it out from under the Langy turn authenticating with it. Both report
 * not-found, matching the tenancy-mismatch branch rather than confirming the
 * id exists.
 */
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ApiKeyService } from "../api-key.service";
import { ApiKeyNotFoundError } from "../errors";
import { LANGY_SESSION_API_KEY_NAME } from "../reserved-names";

const ORG_ID = "org_1";
const USER_ID = "user_1";
const KEY_ID = "key_1";

const REACHED_ADMIN_CHECK = "REACHED_ADMIN_CHECK";

function mockPrisma(name: string): PrismaClient {
  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue({
        id: KEY_ID,
        name,
        organizationId: ORG_ID,
        userId: USER_ID,
        revokedAt: null,
        roleBindings: [],
      }),
    },
    // Reaching a transaction means the guard let the mutation through.
    $transaction: vi.fn().mockRejectedValue(new Error(REACHED_ADMIN_CHECK)),
  } as unknown as PrismaClient;
}

const caller = {
  callerUserId: USER_ID,
  callerIsAdmin: true,
  organizationId: ORG_ID,
};

describe("ApiKeyService system-managed guard", () => {
  describe("given the ephemeral Langy session key", () => {
    it("refuses a rename as not-found", async () => {
      const sut = ApiKeyService.create(mockPrisma(LANGY_SESSION_API_KEY_NAME));

      await expect(
        sut.update({ id: KEY_ID, ...caller, name: "stolen" }),
      ).rejects.toBeInstanceOf(ApiKeyNotFoundError);
    });

    it("refuses a revoke as not-found, so a live turn keeps working", async () => {
      const sut = ApiKeyService.create(mockPrisma(LANGY_SESSION_API_KEY_NAME));

      await expect(sut.revoke({ id: KEY_ID, ...caller })).rejects.toBeInstanceOf(
        ApiKeyNotFoundError,
      );
    });
  });

  describe("given a human-created key", () => {
    it("lets a revoke past the guard", async () => {
      // Proves the guard discriminates on name rather than refusing every key.
      const sut = ApiKeyService.create(mockPrisma("My CI key"));

      await expect(sut.revoke({ id: KEY_ID, ...caller })).rejects.toThrow(
        REACHED_ADMIN_CHECK,
      );
    });
  });
});
