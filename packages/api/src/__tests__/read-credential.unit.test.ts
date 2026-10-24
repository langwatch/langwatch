import type { RestProjectIdentity } from "@langwatch/authorization";
/** Which credential a REST read counts against (specs/security/read-rate-limits.feature). */
import { describe, expect, it } from "vitest";

import { actorReadCredential, restReadCredential } from "../read-credential.ts";
import { recordKeyCredential, recordProjectCredential } from "../rest/credential.ts";

const request = new Request("https://langwatch.test/api/auth/cli/governance/status");

const PROJECT: RestProjectIdentity = {
  id: "project_k",
  name: "K",
  slug: "k",
  teamId: "team_1",
  organizationId: "org_1",
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};

function projectKeyRequest({
  ingestion = false,
  isLangySessionKey,
}: {
  ingestion?: boolean;
  isLangySessionKey?: boolean;
}): Request {
  const keyed = new Request("https://langwatch.test/api/traces");
  recordProjectCredential(keyed, {
    type: "apiKey",
    apiKeyId: "key_k",
    userId: "user_owner",
    organizationId: PROJECT.organizationId,
    ingestSourceType: ingestion ? "otel" : null,
    ingestionTemplateId: ingestion ? "template_1" : null,
    ...(isLangySessionKey ? { isLangySessionKey } : {}),
    project: PROJECT,
  });
  return keyed;
}

describe("actorReadCredential", () => {
  describe("given an operator acting as a person", () => {
    it("counts against the operator, naming the person acted as", () => {
      expect(
        actorReadCredential({ type: "user", id: "user_1", impersonatorId: "operator_1" }),
      ).toEqual({
        id: "operator_1",
        type: "impersonation",
        impersonatorId: "operator_1",
        subjectUserId: "user_1",
      });
    });
  });

  describe("given a person in their own session", () => {
    it("counts against the person's session", () => {
      expect(actorReadCredential({ type: "user", id: "user_1" })).toEqual({
        id: "user_1",
        type: "session",
      });
    });
  });

  describe("given no person", () => {
    it("counts nothing", () => {
      expect(actorReadCredential(null)).toBe(null);
    });
  });
});

describe("restReadCredential through a key door", () => {
  describe("given a project API key", () => {
    it("counts it by its key id as an API key", () => {
      expect(
        restReadCredential({ door: "project", actor: null, request: projectKeyRequest({}) }),
      ).toEqual({ id: "key_k", type: "api_key" });
    });
  });

  describe("given an ingestion key", () => {
    it("counts it by its key id as an ingestion key", () => {
      const request = projectKeyRequest({ ingestion: true });

      expect(restReadCredential({ door: "project", actor: null, request })).toEqual({
        id: "key_k",
        type: "ingestion_key",
      });
    });
  });

  describe("given a Langy session key", () => {
    it("counts it by its key id as a Langy session key", () => {
      const request = projectKeyRequest({ isLangySessionKey: true });

      expect(restReadCredential({ door: "project", actor: null, request })).toEqual({
        id: "key_k",
        type: "langy_session_key",
      });
    });
  });

  describe("given a person's access token through the api_key door", () => {
    it("counts it against its person as an access token", () => {
      const tokened = new Request("https://langwatch.test/api/v1/query");
      recordKeyCredential(tokened, {
        kind: "cliAccessToken",
        userId: "user_cli",
        organizationId: "org_1",
        projectId: "project_k",
        teamId: "team_1",
      });

      expect(restReadCredential({ door: "api_key", actor: null, request: tokened })).toEqual({
        id: "user_cli",
        type: "access_token",
      });
    });
  });

  describe("given a key door that recorded no key", () => {
    it("counts nothing", () => {
      expect(restReadCredential({ door: "api_key", actor: null, request })).toBe(null);
    });
  });
});

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
