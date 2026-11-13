import { describe, expect, it } from "vitest";

import {
  STAFF_ACCESS_COPY_KINDS,
  staffAccessCopyBodySchema,
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

describe("copy requests", () => {
  const side = { ...request, scopes: ["copy:source"], counterpartOrganization: "globex" };

  /** @scenario "A copy side is approved alone and names the other organization" */
  it("accepts a copy side naming both organizations and refuses any other shape", () => {
    expect(staffAccessRequestBodySchema.validate(side)).toBe(true);
    expect(staffAccessRequestBodySchema.validate({ ...side, scopes: ["copy:target"] })).toBe(true);
    const { counterpartOrganization: _other, ...withoutOther } = side;
    expect(staffAccessRequestBodySchema.validate(withoutOther)).toBe(false);
    expect(
      staffAccessRequestBodySchema.validate({ ...side, scopes: ["copy:source", "org:content"] }),
    ).toBe(false);
    expect(
      staffAccessRequestBodySchema.validate({ ...side, counterpartOrganization: "acme" }),
    ).toBe(false);
    expect(
      staffAccessRequestBodySchema.validate({ ...request, counterpartOrganization: "globex" }),
    ).toBe(false);
  });
});

describe("the organization copy allowlist", () => {
  /** @scenario "The copy allowlist names only setup kinds" */
  it("names projects, evaluators, monitors, prompts and datasets and nothing sensitive", () => {
    expect([...STAFF_ACCESS_COPY_KINDS]).toEqual([
      "project",
      "evaluator",
      "monitor",
      "prompt",
      "dataset",
    ]);
    const sensitive =
      /secret|key|provider|member|role|sso|billing|subscription|licen[cs]e|usage|user|grant/i;
    expect(STAFF_ACCESS_COPY_KINDS.filter((kind) => sensitive.test(kind))).toEqual([]);
  });

  it("refuses a copy body with unknown fields", () => {
    expect(staffAccessCopyBodySchema.validate({ sourceOpsToken: "lwsa_x", dryRun: true })).toBe(
      true,
    );
    expect(staffAccessCopyBodySchema.validate({ sourceOpsToken: "lwsa_x", kinds: ["user"] })).toBe(
      false,
    );
  });
});
