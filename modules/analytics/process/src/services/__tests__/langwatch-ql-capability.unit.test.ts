/**
 * The tenant capability a query runs under: one project's hash, or the set of every project a
 * key may read.
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  LangWatchQLCapabilityService,
  LWQL_TENANT_CAPABILITY_MAX_PROJECTS,
} from "../langwatch-ql-capability.service.ts";

const capability = LangWatchQLCapabilityService.create();
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("given a single project's LangWatchQL secret", () => {
  it("is the sha256 hex of the secret", () => {
    expect(capability.tenantCapability({ secret: "sk-lw-alpha" })).toBe(sha256("sk-lw-alpha"));
  });

  it("refuses an empty secret rather than hashing one", () => {
    expect(() => capability.tenantCapability({ secret: "" })).toThrow(/non-empty secret/);
  });
});

describe("given the LangWatchQL secrets of the projects a key can read", () => {
  /** @scenario "The tenant capability is the sorted set of the caller's project key hashes" */
  it("derives the comma-joined, sorted, deduplicated hash of each secret", () => {
    const expected = [sha256("secret-b"), sha256("secret-a")].toSorted().join(",");

    expect(capability.tenantCapabilitySet({ secrets: ["secret-b", "secret-a", "secret-b"] })).toBe(
      expected,
    );
  });

  /** @scenario "The tenant capability is the sorted set of the caller's project key hashes" */
  it("derives the empty capability, which reads zero rows, from an empty set", () => {
    expect(capability.tenantCapabilitySet({ secrets: [] })).toBe("");
  });

  it("derives a set of one as exactly that project's own capability", () => {
    expect(capability.tenantCapabilitySet({ secrets: ["secret-a"] })).toBe(
      capability.tenantCapability({ secret: "secret-a" }),
    );
  });

  it("refuses a blank secret as a wiring bug", () => {
    expect(() => capability.tenantCapabilitySet({ secrets: ["secret-a", ""] })).toThrow(
      /non-empty secret/,
    );
  });

  it("refuses a set wider than the cap rather than silently dropping projects", () => {
    const secrets = Array.from(
      { length: LWQL_TENANT_CAPABILITY_MAX_PROJECTS + 1 },
      (_, index) => `secret-${index}`,
    );

    expect(() => capability.tenantCapabilitySet({ secrets })).toThrow(/cap/);
  });
});
