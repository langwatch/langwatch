/** @see modules/model-provider/specs/model-provider.feature */
import { createApiFixture } from "@langwatch/api-fixture";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { describe, expect, it } from "vitest";

import { createModelProviderTestApp } from "./model-provider.fixture.ts";

describe("ModelProviderApp.platformProviderChain", () => {
  /** @scenario "The platform chain borrows the Google credential from data privacy" */
  it("offers vertex_ai under the credential data privacy lends, on the read", async () => {
    const lent: string[] = [];
    const dataPrivacy = createApiFixture<DataPrivacyApi>({
      intoGoogleApplicationCredentials: (build) => {
        lent.push("lent");
        return build("service-account-json");
      },
    });
    const app = createModelProviderTestApp({ dependencies: { dataPrivacy } });
    expect(lent).toEqual([]);

    const chain = await app.platformProviderChain();

    expect(lent).toEqual(["lent"]);
    expect(chain.map((entry) => [entry.provider, entry.credentialKey])).toEqual([
      ["vertex_ai", "GOOGLE_APPLICATION_CREDENTIALS"],
    ]);
  });
});
