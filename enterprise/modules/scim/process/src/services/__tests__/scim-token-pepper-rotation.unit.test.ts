// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A directory's token across a CREDENTIALS_SECRET rotation: its digest was stored under
 * the old pepper, and the directory keeps presenting the same token.
 * @see specs/self-hosting/credentials-secret-rotation.feature
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryScimRepository } from "../../repositories/memory/memory.scim.repository.ts";
import { digestScimToken } from "../../rules/scim-token-digest.rules.ts";
import { ScimTokenService } from "../scim-token.service.ts";
import { QuietScimSyncLifecycle } from "./support/quiet-scim-sync-lifecycle.ts";

const TOKEN = "a-directory-token-issued-before-the-rotation";
const OLD_PEPPER = "old-credentials-secret";
const NEW_PEPPER = "new-credentials-secret";

const digestUnder = (pepper: string): string =>
  digestScimToken({ token: TOKEN, scheme: "hmac-sha256", pepper });

async function tokenStoredUnderOldPepper() {
  const repository = MemoryScimRepository.create();
  const stored = await repository.createToken({
    organizationId: "org_1",
    connectionId: "okta-primary",
    hashedToken: digestUnder(OLD_PEPPER),
    hashScheme: "hmac-sha256",
    description: null,
  });
  return { repository, stored };
}

function tokensOver({
  repository,
  previousTokenPepper,
}: {
  repository: MemoryScimRepository;
  previousTokenPepper?: string;
}): ScimTokenService {
  return ScimTokenService.create({
    repository,
    entitlements: createApiFixture<EntitlementApi>({
      getActivePlan: async () => ({
        planSource: "free",
        type: "ENTERPRISE",
        name: "Test",
        free: false,
        maxMembers: 1,
        maxMembersLite: 1,
        maxMessagesPerMonth: 1,
        canPublish: false,
        prices: { USD: 0, EUR: 0 },
      }),
    }),
    lifecycle: new QuietScimSyncLifecycle(),
    tokenPepper: NEW_PEPPER,
    previousTokenPepper,
  });
}

describe("given a SCIM token whose digest was stored under the pepper a rotation retired", () => {
  describe("when the old secret is still known as the previous pepper", () => {
    /** @scenario "A SCIM token issued before the rotation keeps working and moves to the new secret on use" */
    it("accepts the token and rewrites its digest under the current pepper", async () => {
      const { repository, stored } = await tokenStoredUnderOldPepper();
      const tokens = tokensOver({ repository, previousTokenPepper: OLD_PEPPER });

      await expect(tokens.verifyToken({ token: TOKEN })).resolves.toMatchObject({
        status: "ok",
        id: stored.id,
      });

      expect(await repository.findTokensByHashes([digestUnder(NEW_PEPPER)])).toEqual([
        expect.objectContaining({ id: stored.id }),
      ]);
      expect(await repository.findTokensByHashes([digestUnder(OLD_PEPPER)])).toEqual([]);
    });

    it("keeps accepting it after the previous pepper is removed, once it has been used", async () => {
      const { repository, stored } = await tokenStoredUnderOldPepper();
      await tokensOver({ repository, previousTokenPepper: OLD_PEPPER }).verifyToken({
        token: TOKEN,
      });

      await expect(tokensOver({ repository }).verifyToken({ token: TOKEN })).resolves.toMatchObject(
        {
          status: "ok",
          id: stored.id,
        },
      );
    });

    it("refuses a different token, and leaves the stored digest alone", async () => {
      const { repository } = await tokenStoredUnderOldPepper();
      const tokens = tokensOver({ repository, previousTokenPepper: OLD_PEPPER });

      await expect(tokens.verifyToken({ token: "another-token-entirely" })).resolves.toEqual({
        status: "invalid_token",
      });
      expect(await repository.findTokensByHashes([digestUnder(OLD_PEPPER)])).toHaveLength(1);
    });

    it("refuses to mint a token whose value the old digest already names", async () => {
      const { repository } = await tokenStoredUnderOldPepper();
      const tokens = tokensOver({ repository, previousTokenPepper: OLD_PEPPER });
      repository.connections.push({ organizationId: "org_1", connectionId: "okta-primary" });

      await expect(
        tokens.generateToken({
          organizationId: "org_1",
          connectionId: "okta-primary",
          secret: TOKEN,
        }),
      ).rejects.toMatchObject({ code: "scim_token_unavailable" });
    });
  });

  describe("when the previous pepper was removed before the token was used", () => {
    it("refuses the token", async () => {
      const { repository } = await tokenStoredUnderOldPepper();

      await expect(tokensOver({ repository }).verifyToken({ token: TOKEN })).resolves.toEqual({
        status: "invalid_token",
      });
    });
  });
});
