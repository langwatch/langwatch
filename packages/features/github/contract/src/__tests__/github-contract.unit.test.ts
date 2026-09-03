import { describe, expect, it } from "vitest";
import { githubInstallStatePayloadSchema } from "../index";

describe("GitHub install state contract", () => {
  it("rejects incomplete or extended callback state", () => {
    const valid = {
      userId: "user-1",
      organizationId: "org-1",
      mode: "popup",
      returnTo: "/settings/integrations#github",
      issuedAt: 1_700_000_000_000,
      nonce: "nonce-1",
      nonceRegistered: true,
    };

    expect(githubInstallStatePayloadSchema.safeParse(valid).success).toBe(true);
    expect(
      githubInstallStatePayloadSchema.safeParse({ ...valid, nonce: void 0 }).success,
    ).toBe(false);
    expect(
      githubInstallStatePayloadSchema.safeParse({ ...valid, attackerField: true })
        .success,
    ).toBe(false);
  });
});
