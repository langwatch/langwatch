// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

import {
  azureBillSourceId,
  findAzureBillHistoryComplaints,
  withAzureBillIdentity,
} from "../azure-bill-identity.rules.ts";

const subscription = "aaaaaaaa-0000-4000-8000-000000000001";

describe("withAzureBillIdentity()", () => {
  it("keeps the original identity through several archived replacements", () => {
    const config = withAzureBillIdentity({
      history: [
        { id: "first", parserConfig: { azureSubscriptionId: subscription } },
        {
          id: "second",
          parserConfig: {
            azureSubscriptionId: subscription,
            _azureBillSourceId: "first",
          },
        },
      ],
      parserConfig: { azureSubscriptionId: subscription.toUpperCase() },
    });
    expect(azureBillSourceId({ id: "third", parserConfig: config })).toBe("first");
  });

  it("remembers a disconnected subscription for a later replacement", () => {
    const removed = withAzureBillIdentity({
      history: [],
      sourceId: "first",
      storedConfig: { azureSubscriptionId: subscription },
      parserConfig: {},
    });
    const replacement = withAzureBillIdentity({
      history: [{ id: "first", parserConfig: removed }],
      parserConfig: { azureSubscriptionId: subscription },
    });
    expect(azureBillSourceId({ id: "second", parserConfig: replacement })).toBe("first");
  });

  it("ignores a caller's forged billing identity on create", () => {
    const config = withAzureBillIdentity({
      history: [],
      parserConfig: {
        azureSubscriptionId: subscription,
        _azureBillSourceId: "victim",
        _azureBillSubscriptionId: "other",
      },
    });
    expect(azureBillSourceId({ id: "new", parserConfig: config })).toBe("new");
  });

  it("keeps the stored identity when an edit attempts to replace it", () => {
    const config = withAzureBillIdentity({
      history: [],
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
    expect(azureBillSourceId({ id: "second", parserConfig: config })).toBe("first");
  });

  it("does not reuse a different subscription's history", () => {
    const config = withAzureBillIdentity({
      history: [{ id: "other", parserConfig: { azureSubscriptionId: "different" } }],
      parserConfig: { azureSubscriptionId: subscription },
    });
    expect(azureBillSourceId({ id: "new", parserConfig: config })).toBe("new");
  });

  it("refuses an ambiguous history instead of silently moving existing money", () => {
    expect(
      findAzureBillHistoryComplaints({
        history: ["first", "second"].map((id) => ({
          id,
          parserConfig: { azureSubscriptionId: subscription },
        })),
        parserConfig: { azureSubscriptionId: subscription },
      }),
    ).toHaveLength(1);
  });
});
