import { describe, expect, it } from "vitest";

import { mountedSocialMethodIds } from "../mounted-social-methods.rules.ts";

const marker = "content-marker";

describe("mountedSocialMethodIds", () => {
  /** @scenario "A social provider this deployment never mounted is never offered" */
  it("leaves out a provider whose credentials are incomplete", () => {
    expect(
      mountedSocialMethodIds({
        configuration: { provider: "google", googleClientId: marker, githubClientId: marker },
      }),
    ).toEqual([]);
  });

  /** @scenario "Social providers mount on their credentials, not on the provider env" */
  it("mounts every provider with credentials, under the id the rail dials, and none in email mode", () => {
    const configuration = {
      githubClientId: marker,
      githubClientSecret: marker,
      azureAdClientId: marker,
      azureAdClientSecret: marker,
      azureAdTenantId: marker,
    };

    expect(
      mountedSocialMethodIds({ configuration: { provider: "github", ...configuration } }),
    ).toEqual(["github", "azure-ad"]);
    expect(
      mountedSocialMethodIds({ configuration: { provider: "email", ...configuration } }),
    ).toEqual([]);
  });
});
