// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * A connection is not stored until the provider says whose account it reads.
 *
 * The account is what the duplicate guard compares, and it is asked for while
 * the connection is being saved. If the provider cannot be asked — the key is
 * wrong, the admin API is down, the network is not there — the honest answer is
 * to fail the save. Letting it through unchecked is the same as having no guard
 * at all: the next save has nothing to compare against, and the two connections
 * then read the same bill for as long as they both live.
 *
 * The provider call is injected rather than mocked at the module boundary, so
 * the seam the service actually depends on is the one a test can see.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 * Decision: 00d claim C, settlement 6.
 */

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";

// A real 32-byte hex string: the encryption helper rejects anything else.
vi.mock("~/env.mjs", () => ({ env: { CREDENTIALS_SECRET: "ab".repeat(32) } }));
vi.mock("~/server/api/enterprise", () => ({ isEnterpriseTier: () => true }));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    commands: { ingestionPull: {} },
    planProvider: { getActivePlan: async () => ({ type: "ENTERPRISE" }) },
  }),
}));
vi.mock("@ee/governance/services/pullers/ingestionPullLifecycle", () => ({
  syncIngestionPullSource: vi.fn(),
}));
vi.mock("@ee/governance/services/governanceProject.service", () => ({
  ensureHiddenGovernanceProject: vi.fn(),
}));

import { IngestionSourceService } from "@ee/governance/services/activity-monitor/ingestionSource.service";

const ORG = "org_test_0001";

const fakePrisma = () => {
  const create = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "src_new", ...data }),
    );
  const client = {
    ingestionSource: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create,
    },
  };
  return { client: client as unknown as PrismaClient, create };
};

const createInput = {
  organizationId: ORG,
  sourceType: "anthropic_admin" as const,
  name: "Anthropic spend",
  parserConfig: {
    adapter: "anthropic_admin",
    report: "cost",
    credentials: { apiKey: "sk-ant-admin-TESTKEY-00000000000" },
  },
};

describe("createSource, given the provider cannot be asked which account an administrator key belongs to", () => {
  describe("when the admin saves a connection carrying that key", () => {
    /** @scenario "A connection whose account the provider will not confirm is not saved" */
    it("fails the save and says the account could not be confirmed", async () => {
      const { client } = fakePrisma();
      // Not yet implemented: the save-time account lookup, injected so the
      // service's dependency on the provider is visible at its seam.
      const service = IngestionSourceService.create(client, {
        lookUpProviderAccount: vi
          .fn()
          .mockRejectedValue(new Error("ECONNREFUSED")),
      });

      await expect(service.createSource(createInput)).rejects.toThrow(
        /could not confirm which account/i,
      );
    });

    /** @scenario "A connection whose account the provider will not confirm is not saved" */
    it("creates no connection at all", async () => {
      // A refusal that had already written the row would leave the account
      // unclaimed and the connection live — the exact state the guard exists
      // to prevent, reached by way of an error message.
      const { client, create } = fakePrisma();
      const service = IngestionSourceService.create(client, {
        lookUpProviderAccount: vi
          .fn()
          .mockRejectedValue(new Error("ECONNREFUSED")),
      });

      await service.createSource(createInput).catch(() => undefined);

      expect(create).not.toHaveBeenCalled();
    });
  });
});

describe("createSource, given the provider names the account", () => {
  describe("when the admin saves a connection carrying that key", () => {
    it("stores the account the provider reported beside the connection", async () => {
      // What is kept is the account name the provider itself reports. It is
      // not a secret and it cannot be turned back into a key.
      const { client, create } = fakePrisma();
      const service = IngestionSourceService.create(client, {
        lookUpProviderAccount: vi
          .fn()
          .mockResolvedValue("org_test_anthropic_0001"),
      });

      await service.createSource(createInput);

      expect(create.mock.calls[0]![0].data).toMatchObject({
        providerAccountId: "org_test_anthropic_0001",
      });
    });
  });
});
