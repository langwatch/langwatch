/**
 * What a license's managed key dispatches to on LangWatch Cloud.
 *
 * A CONNECT key reaches none of the customer organization's own credentials.
 * With managed models in the license it reaches the platform's own providers
 * instead; without the entitlement it reaches nothing at all, which is what
 * leaves the refusal to the gateway's entitlement check rather than to an
 * empty chain.
 *
 * Spec: specs/self-hosting/connected-services/managed-models-provider.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { eligibleModelProvidersForVk } from "../scopeResolver";
import type { VirtualKeyWithScopes } from "../virtualKey.repository";

const NEXT_YEAR = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

function connectKey(): VirtualKeyWithScopes {
  return {
    id: "vk-connect-1",
    organizationId: "org-customer-1",
    purpose: "CONNECT",
    routingPolicyId: null,
    scopes: [],
  } as unknown as VirtualKeyWithScopes;
}

/**
 * A registry the license row answers from, so the query's own predicates are
 * exercised: a row that is revoked, out of term or another organization's must
 * not entitle this key.
 */
function registry(
  rows: Array<{
    virtualKeyId: string;
    organizationId: string;
    services: string[];
    revokedAt?: Date | null;
    supersededAt?: Date | null;
    expiresAt?: Date;
  }>,
): PrismaClient {
  const findFirst = vi.fn(async ({ where }: { where: Record<string, any> }) =>
    rows.find(
      (row) =>
        row.virtualKeyId === where.virtualKeyId &&
        row.organizationId === where.organizationId &&
        (row.revokedAt ?? null) === null &&
        (row.supersededAt ?? null) === null &&
        (row.expiresAt ?? NEXT_YEAR) > where.expiresAt.gt,
    ),
  );
  return { issuedLicense: { findFirst } } as unknown as PrismaClient;
}

describe("the providers a license's managed key reaches", () => {
  const previous = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "sk-platform-openai";
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  });

  describe("given the license includes managed models", () => {
    /** @scenario An entitled license key resolves to the platform's shared providers */
    it("resolves to the platform's own providers, and to none without the entitlement", async () => {
      const entitled = registry([
        {
          virtualKeyId: "vk-connect-1",
          organizationId: "org-customer-1",
          services: ["instant_evals", "managed_models"],
        },
      ]);
      const unentitled = registry([
        {
          virtualKeyId: "vk-connect-1",
          organizationId: "org-customer-1",
          services: ["instant_evals"],
        },
      ]);

      const reached = await eligibleModelProvidersForVk(entitled, connectKey());

      expect(reached.map((mp) => mp.provider)).toContain("openai");
      expect(
        await eligibleModelProvidersForVk(unentitled, connectKey()),
      ).toEqual([]);
    });
  });

  describe("given the license is revoked, out of term or another organization's", () => {
    it("resolves to no provider at all", async () => {
      const cases: PrismaClient[] = [
        registry([
          {
            virtualKeyId: "vk-connect-1",
            organizationId: "org-customer-1",
            services: ["managed_models"],
            revokedAt: new Date(),
          },
        ]),
        registry([
          {
            virtualKeyId: "vk-connect-1",
            organizationId: "org-customer-1",
            services: ["managed_models"],
            expiresAt: new Date(Date.now() - 1000),
          },
        ]),
        registry([
          {
            virtualKeyId: "vk-connect-1",
            organizationId: "org-other",
            services: ["managed_models"],
          },
        ]),
        registry([]),
      ];

      for (const prisma of cases) {
        expect(await eligibleModelProvidersForVk(prisma, connectKey())).toEqual(
          [],
        );
      }
    });
  });
});
