import { describe, expect, it } from "vitest";

import {
  staffAccessRedeemBodySchema,
  staffAccessRequestBodySchema,
} from "../staff-access-rest.schemas.ts";

const challenge = "A".repeat(43);
const request = {
  scopes: ["org:metadata"],
  organization: "acme",
  reason: "Check ACME usage counts",
  codeChallenge: challenge,
  codeChallengeMethod: "S256",
  machine: "laptop",
};

describe("staffAccessRequestBodySchema", () => {
  it("accepts an organization scope that names its organization", () => {
    expect(staffAccessRequestBodySchema.validate(request)).toBe(true);
  });

  it("refuses an organization scope without an organization", () => {
    const { organization: _organization, ...withoutOrganization } = request;
    const result = staffAccessRequestBodySchema.safeParse(withoutOrganization);
    expect(result.error?.issues[0]?.path).toEqual(["organization"]);
  });

  it("refuses ops:read naming an organization", () => {
    const result = staffAccessRequestBodySchema.safeParse({ ...request, scopes: ["ops:read"] });
    expect(result.error?.issues[0]?.path).toEqual(["organization"]);
  });

  it("refuses a repeated scope", () => {
    const result = staffAccessRequestBodySchema.safeParse({
      ...request,
      scopes: ["org:metadata", "org:metadata"],
    });
    expect(result.error?.issues[0]?.path).toEqual(["scopes"]);
  });

  it("refuses a plain challenge method and unknown fields", () => {
    expect(
      staffAccessRequestBodySchema.validate({ ...request, codeChallengeMethod: "plain" }),
    ).toBe(false);
    expect(staffAccessRequestBodySchema.validate({ ...request, spend: true })).toBe(false);
  });
});

describe("staffAccessRedeemBodySchema", () => {
  it("accepts a 43 to 128 character verifier and refuses a shorter one", () => {
    expect(staffAccessRedeemBodySchema.validate({ codeVerifier: "a".repeat(43) })).toBe(true);
    expect(staffAccessRedeemBodySchema.validate({ codeVerifier: "a".repeat(42) })).toBe(false);
  });
});
