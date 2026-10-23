/** Which credential a REST read counts against (specs/security/read-rate-limits.feature). */
import { describe, expect, it } from "vitest";

import { restReadCredential } from "../read-credential.ts";

const request = new Request("https://langwatch.test/api/auth/cli/governance/status");

describe("restReadCredential", () => {
  describe("given a read through the CLI token door", () => {
    it("counts it against the token's person as an access token", () => {
      expect(
        restReadCredential({
          door: "cli_token",
          actor: { type: "user", id: "user_cli" },
          scope: { type: "organization", id: "org_1" },
          request,
        }),
      ).toEqual({ id: "user_cli", type: "access_token" });
    });

    it("counts nothing when the door resolved no person", () => {
      expect(restReadCredential({ door: "cli_token", actor: null, scope: null, request })).toBe(
        null,
      );
    });
  });

  describe("given a read through a door that resolves no credential", () => {
    it("counts nothing", () => {
      expect(
        restReadCredential({
          door: "internal_secret",
          actor: { type: "user", id: "user_1" },
          scope: null,
          request,
        }),
      ).toBe(null);
    });
  });
});
