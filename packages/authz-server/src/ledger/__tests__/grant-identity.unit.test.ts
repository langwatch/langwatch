import { getEnvironment, setEnvironment } from "@langwatch/ksuid";
import { describe, expect, it } from "vitest";
import { deriveGrantId } from "../grant-identity";

const ORG = "org_acme";
const OCCURRED_AT = 1_755_000_000_000;

describe("grant identity", () => {
  const base = {
    organizationId: ORG,
    principal: { type: "user" as const, id: "user_alice" },
    scope: { type: "TEAM" as const, id: "team_client_a" },
    occurredAtMs: OCCURRED_AT,
  };

  describe("when the same fact is derived twice", () => {
    it("yields the same id — a KSUID with no random bits", () => {
      const a = deriveGrantId(base);
      const b = deriveGrantId({ ...base });
      expect(a).toBe(b);
      expect(a).toContain("grant_");
    });
  });

  describe("when the deriving process's ksuid environment differs", () => {
    it("derives the same id, so two processes cannot disagree about one row", () => {
      // The environment is a display prefix, but it lands in the string this
      // returns. Reading it from ambient configuration would make a worker
      // and a web pod derive two ids for one legacy row, and the
      // projection's upserts would stop converging.
      const original = getEnvironment();
      try {
        setEnvironment("dev");
        const fromDev = deriveGrantId(base);
        setEnvironment("staging");
        const fromStaging = deriveGrantId(base);

        expect(fromDev).toBe(fromStaging);
        expect(fromDev.startsWith("grant_")).toBe(true);
      } finally {
        setEnvironment(original);
      }
    });
  });

  describe("when any part of the fact differs", () => {
    it("yields a different id per scope, principal, org, token, and business time", () => {
      const ids = [
        deriveGrantId(base),
        deriveGrantId({ ...base, organizationId: "org_other" }),
        deriveGrantId({
          ...base,
          principal: { type: "api_key", id: "user_alice" },
        }),
        deriveGrantId({
          ...base,
          scope: { type: "PROJECT", id: "team_client_a" },
        }),
        deriveGrantId({ ...base, resourceToken: "tok_1" }),
        deriveGrantId({ ...base, resourceToken: "tok_2" }),
        deriveGrantId({ ...base, occurredAtMs: OCCURRED_AT + 60_000 }),
      ];
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("ignores sub-second differences in business time", () => {
      // KSUID timestamps are second-precision; a retry landing in the same
      // second as the original command derives the same id.
      expect(deriveGrantId({ ...base, occurredAtMs: OCCURRED_AT + 500 })).toBe(
        deriveGrantId(base),
      );
    });
  });

  describe("when two facts differ only in where one field ends and the next begins", () => {
    it("still yields different ids", () => {
      // This is the whole reason the hash pre-image is joined on a unit
      // separator rather than concatenated. Without one, these two grants —
      // different principals at different scopes — share a pre-image, derive
      // one id, and the projection's upsert silently overwrites one with the
      // other.
      const left = deriveGrantId({
        ...base,
        principal: { type: "user", id: "a" },
        scope: { type: "TEAM", id: "bc" },
      });
      const right = deriveGrantId({
        ...base,
        principal: { type: "user", id: "ab" },
        scope: { type: "TEAM", id: "c" },
      });
      expect(left).not.toBe(right);
    });
  });
});
