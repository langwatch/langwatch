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

describe("ops:copy requests", () => {
  /** @scenario "ops:copy comes with org:content or org:support" */
  it("refuses ops:copy alone and accepts it with org:content on an organization", () => {
    const alone = staffAccessRequestBodySchema.safeParse({ ...request, scopes: ["ops:copy"] });
    expect(alone.success).toBe(false);
    expect(
      staffAccessRequestBodySchema.validate({ ...request, scopes: ["ops:copy", "org:content"] }),
    ).toBe(true);
    expect(
      staffAccessRequestBodySchema.validate({ ...request, scopes: ["ops:copy", "org:support"] }),
    ).toBe(true);
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
