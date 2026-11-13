import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  approvalChallengeOf,
  mintToken,
  parseToken,
  secretMatches,
  shownStatus,
  typedNameRequired,
} from "../staff-access.rules.ts";

const fields = {
  requestId: "staffrequest_1",
  scopes: ["org:support", "org:content"],
  organizationId: "org_acme",
  organizationName: "ACME",
  counterpartOrganizationId: null,
  counterpartOrganizationName: null,
  copyGrant: [] as string[],
  reason: "fix the evaluator",
  machine: "laptop",
  requestIp: "203.0.113.7",
  codeChallenge: "c".repeat(43),
  spendApproved: false,
  expiresAt: "2026-11-02T10:10:00.000Z",
};

describe("approvalChallengeOf", () => {
  it("is the same for the same fields in any scope order", () => {
    expect(approvalChallengeOf(fields)).toBe(
      approvalChallengeOf({ ...fields, scopes: ["org:content", "org:support"] }),
    );
  });

  it("changes with the spend tick and with any shown field", () => {
    const base = approvalChallengeOf(fields);
    expect(approvalChallengeOf({ ...fields, spendApproved: true })).not.toBe(base);
    expect(approvalChallengeOf({ ...fields, reason: "other" })).not.toBe(base);
    expect(approvalChallengeOf({ ...fields, requestIp: null })).not.toBe(base);
  });

  /** @scenario "The approval page shows the other organization and the target grant" */
  it("signs a copy side's other organization and the target grant", () => {
    const copy = {
      ...fields,
      scopes: ["copy:target"],
      counterpartOrganizationId: "org_globex",
      counterpartOrganizationName: "Globex",
      copyGrant: ["project:create", "datasets:create"],
    };
    const base = approvalChallengeOf(copy);

    expect(approvalChallengeOf({ ...copy, counterpartOrganizationId: "org_initech" })).not.toBe(
      base,
    );
    expect(approvalChallengeOf({ ...copy, copyGrant: ["project:create"] })).not.toBe(base);
    expect(approvalChallengeOf({ ...copy, copyGrant: ["datasets:create", "project:create"] })).toBe(
      base,
    );
  });
});

describe("typedNameRequired", () => {
  it("asks for content always and for support only with spend", () => {
    expect(typedNameRequired({ scopes: ["org:content"], spendApproved: false })).toBe(true);
    expect(typedNameRequired({ scopes: ["org:support"], spendApproved: false })).toBe(false);
    expect(typedNameRequired({ scopes: ["org:support"], spendApproved: true })).toBe(true);
    expect(typedNameRequired({ scopes: ["org:metadata"], spendApproved: false })).toBe(false);
  });
});

describe("tokens", () => {
  it("parses what it mints and matches only the right secret", () => {
    const minted = mintToken("lwsr_");
    const parsed = parseToken({ token: minted.token, prefix: "lwsr_" });

    expect(parsed?.lookupId).toBe(minted.lookupId);
    expect(secretMatches({ secret: parsed?.secret ?? "", hashed: minted.hashedSecret })).toBe(true);
    expect(secretMatches({ secret: "wrong", hashed: minted.hashedSecret })).toBe(false);
    expect(parseToken({ token: minted.token, prefix: "lwsa_" })).toBeUndefined();
    expect(parseToken({ token: "lwsr_nosecret", prefix: "lwsr_" })).toBeUndefined();
  });
});

describe("shownStatus", () => {
  const at = Temporal.Instant.from("2026-11-02T10:30:00Z");
  const expiresAt = Temporal.Instant.from("2026-11-02T10:10:00Z");

  it("reads an undecided request past its ten minutes as expired", () => {
    expect(shownStatus({ status: "pending", expiresAt, accessExpiresAt: null, at })).toBe(
      "expired",
    );
    expect(shownStatus({ status: "denied", expiresAt, accessExpiresAt: null, at })).toBe("denied");
  });

  it("reads a redeemed session past its hour as expired", () => {
    const accessExpiresAt = Temporal.Instant.from("2026-11-02T10:20:00Z");
    expect(shownStatus({ status: "redeemed", expiresAt, accessExpiresAt, at })).toBe("expired");
    expect(
      shownStatus({
        status: "redeemed",
        expiresAt,
        accessExpiresAt: Temporal.Instant.from("2026-11-02T11:00:00Z"),
        at,
      }),
    ).toBe("redeemed");
  });
});
