import { describe, expect, it } from "vitest";

import { githubInstallStatePayloadSchema } from "../index.ts";

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

    expect(githubInstallStatePayloadSchema.validate(valid)).toBe(true);
    expect(githubInstallStatePayloadSchema.validate({ ...valid, nonce: void 0 })).toBe(false);
    expect(githubInstallStatePayloadSchema.validate({ ...valid, attackerField: true })).toBe(false);
  });
});
