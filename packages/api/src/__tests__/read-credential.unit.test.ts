/** Which credential a REST read counts against (specs/security/read-rate-limits.feature). */
import { describe, expect, it } from "vitest";

import { restReadCredential } from "../read-credential.ts";
import { recordKeyCredential, recordProjectCredential } from "../rest/credential.ts";

const request = new Request("https://langwatch.test/api/auth/cli/governance/status");

describe("restReadCredential", () => {
  describe("given a read through the CLI token door", () => {
    it("counts it against the token's person as an access token", () => {
      expect(
        restReadCredential({
          door: "cli_token",
          actor: { type: "user", id: "user_cli" },
          request,
        }),
      ).toEqual({ id: "user_cli", type: "access_token" });
    });

    it("counts nothing when the door resolved no person", () => {
      expect(restReadCredential({ door: "cli_token", actor: null, request })).toBe(null);
    });
  });

  describe("given a read through a door that resolves no credential", () => {
    it("counts nothing", () => {
      expect(
        restReadCredential({
          door: "internal_secret",
          actor: { type: "user", id: "user_1" },
          request,
        }),
      ).toBe(null);
    });
  });

  describe("given legacy project keys of two projects through the api_key door", () => {
    it("counts each against its own project", () => {
      const first = new Request("https://langwatch.test/api/v1/query");
      const second = new Request("https://langwatch.test/api/v1/query");
      recordKeyCredential(first, { kind: "project", projectId: "project_a" });
      recordKeyCredential(second, { kind: "project", projectId: "project_b" });

      expect(restReadCredential({ door: "api_key", actor: null, request: first })).toEqual({
        id: "project_a",
        type: "legacy_project_key",
      });
      expect(restReadCredential({ door: "api_key", actor: null, request: second })).toEqual({
        id: "project_b",
        type: "legacy_project_key",
      });
    });
  });

  describe("given a legacy project key through the project door", () => {
    it("counts it against its project", () => {
      const legacy = new Request("https://langwatch.test/api/traces");
      recordProjectCredential(legacy, {
        type: "legacyProjectKey",
        project: {
          id: "project_c",
          name: "C",
          slug: "c",
          teamId: "team_1",
          organizationId: "org_1",
        },
      } as Parameters<typeof recordProjectCredential>[1]);

      expect(restReadCredential({ door: "project", actor: null, request: legacy })).toEqual({
        id: "project_c",
        type: "legacy_project_key",
      });
    });
  });
});
