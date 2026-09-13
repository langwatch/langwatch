// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { azureBillSourceId, withAzureBillIdentity } from "../azureBillIdentity";

const subscription = "aaaaaaaa-0000-4000-8000-000000000001";
function clientWith(
  history: Array<{ id: string; parserConfig: Record<string, unknown> }>,
) {
  return {
    ingestionSource: { findMany: vi.fn().mockResolvedValue(history) },
  } as unknown as PrismaClient;
}

describe("withAzureBillIdentity()", () => {
  it("keeps the original identity through several archived replacements", async () => {
    const config = await withAzureBillIdentity({
      prisma: clientWith([
        { id: "first", parserConfig: { azureSubscriptionId: subscription } },
        {
          id: "second",
          parserConfig: {
            azureSubscriptionId: subscription,
            _azureBillSourceId: "first",
          },
        },
      ]),
      organizationId: "org",
      parserConfig: { azureSubscriptionId: subscription.toUpperCase() },
    });
    expect(azureBillSourceId({ id: "third", parserConfig: config })).toBe(
      "first",
    );
  });

  it("remembers a disconnected subscription for a later replacement", async () => {
    const removed = await withAzureBillIdentity({
      prisma: clientWith([]),
      organizationId: "org",
      sourceId: "first",
      storedConfig: { azureSubscriptionId: subscription },
      parserConfig: {},
    });
    const replacement = await withAzureBillIdentity({
      prisma: clientWith([{ id: "first", parserConfig: removed }]),
      organizationId: "org",
      parserConfig: { azureSubscriptionId: subscription },
    });
    expect(azureBillSourceId({ id: "second", parserConfig: replacement })).toBe(
      "first",
    );
  });

  it("ignores a caller's forged billing identity on create", async () => {
    const config = await withAzureBillIdentity({
      prisma: clientWith([]),
      organizationId: "org",
      parserConfig: {
        azureSubscriptionId: subscription,
        _azureBillSourceId: "victim",
        _azureBillSubscriptionId: "other",
      },
    });
    expect(azureBillSourceId({ id: "new", parserConfig: config })).toBe("new");
  });

  it("keeps the stored identity when an edit attempts to replace it", async () => {
    const config = await withAzureBillIdentity({
      prisma: clientWith([]),
      organizationId: "org",
      sourceId: "second",
      storedConfig: {
        azureSubscriptionId: subscription,
        _azureBillSourceId: "first",
      },
      parserConfig: {
        azureSubscriptionId: subscription,
        _azureBillSourceId: "victim",
      },
    });
    expect(azureBillSourceId({ id: "second", parserConfig: config })).toBe(
      "first",
    );
  });

  it("does not reuse a different subscription's history", async () => {
    const config = await withAzureBillIdentity({
      prisma: clientWith([
        { id: "other", parserConfig: { azureSubscriptionId: "different" } },
      ]),
      organizationId: "org",
      parserConfig: { azureSubscriptionId: subscription },
    });
    expect(azureBillSourceId({ id: "new", parserConfig: config })).toBe("new");
  });

  it("refuses an ambiguous history instead of silently moving existing money", async () => {
    await expect(
      withAzureBillIdentity({
        prisma: clientWith(
          ["first", "second"].map((id) => ({
            id,
            parserConfig: { azureSubscriptionId: subscription },
          })),
        ),
        organizationId: "org",
        parserConfig: { azureSubscriptionId: subscription },
      }),
    ).rejects.toThrow(/multiple billing histories/);
  });

  it("scopes the historical lookup to the requesting organization", async () => {
    const prisma = clientWith([]);
    await withAzureBillIdentity({
      prisma,
      organizationId: "org",
      parserConfig: { azureSubscriptionId: subscription },
    });
    expect(prisma.ingestionSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org",
          sourceType: "copilot_studio_dataverse",
        },
      }),
    );
  });
});
