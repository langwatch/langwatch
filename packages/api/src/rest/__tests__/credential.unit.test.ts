/**
 * @vitest-environment node
 * What a REST handler learns about the credential: the principal, and the two guards
 * standing between a key and personal usage data. Refusals branch on `code`, not copy.
 */

import {
  principalOfCredential,
  credentialPrincipalOf,
  organizationCredentialPrincipalOf,
  organizationCredentialPrincipalOfToken,
  resolvePersonalCaller,
} from "@langwatch/api/rest";
import type {
  PrincipalRef,
  RestCredentialPrincipal,
  RestResolvedProjectCredential,
} from "@langwatch/authorization";
import { Context } from "hono";
import { describe, expect, it } from "vitest";

/** A context that answers only what the middleware installed. */
const contextWith = (variables: Record<string, unknown>): Context => {
  const context = new Context(new Request("http://localhost/api/project"));
  for (const [key, value] of Object.entries(variables)) context.set(key, value);
  return context;
};

const PROJECT = { id: "project-1", slug: "p", teamId: "team-1" };

describe("reading the credential a project request arrived with", () => {
  describe("given a scoped API key minted for a Langy session", () => {
    it("carries the session marker through to the principal", () => {
      const principal = credentialPrincipalOf(
        contextWith({
          resolvedToken: {
            type: "apiKey",
            apiKeyId: "key_1",
            userId: "user_1",
            organizationId: "organization-1",
            isLangySessionKey: true,
            project: PROJECT,
          },
        }),
      );

      expect(principal).toEqual({
        kind: "apiKey",
        apiKeyId: "key_1",
        userId: "user_1",
        organizationId: "organization-1",
        projectId: "project-1",
        teamId: "team-1",
        isLangySessionKey: true,
      });
    });
  });

  describe("given an ordinary key that names no session", () => {
    it("leaves the session marker unset rather than asserting it is false", () => {
      const principal = credentialPrincipalOf(
        contextWith({
          resolvedToken: {
            type: "apiKey",
            apiKeyId: "key_1",
            userId: null,
            organizationId: "organization-1",
            project: PROJECT,
          },
        }),
      );

      expect(principal).not.toHaveProperty("isLangySessionKey");
    });
  });
});

describe("reading the credential an organization request arrived with", () => {
  describe("given a resolved organization key", () => {
    it("names the key and the member it acts as", () => {
      const principal = organizationCredentialPrincipalOf(
        contextWith({
          orgResolvedToken: {
            type: "apiKey-org",
            apiKeyId: "key_2",
            userId: "user_2",
            organizationId: "organization-2",
          },
        }),
      );

      expect(principal).toEqual({
        kind: "organizationApiKey",
        apiKeyId: "key_2",
        userId: "user_2",
        organizationId: "organization-2",
      });
    });
  });

  describe("given a service key that acts as nobody", () => {
    it("answers with a null member rather than dropping the key", () => {
      expect(
        organizationCredentialPrincipalOfToken({
          type: "apiKey-org",
          apiKeyId: "key_3",
          userId: null,
          organizationId: "organization-3",
        }),
      ).toEqual({
        kind: "organizationApiKey",
        apiKeyId: "key_3",
        userId: null,
        organizationId: "organization-3",
      });
    });
  });

  describe("when no organization authentication ran", () => {
    it("raises rather than answering from a blank principal", () => {
      expect(() => organizationCredentialPrincipalOf(contextWith({}))).toThrow(
        /organization authentication middleware/,
      );
    });
  });
});

const OWNER_ID = "user_owner";

/** A modern key issued to somebody, the ordinary case. */
const keyOf = (userId: string | null): RestCredentialPrincipal => ({
  kind: "apiKey",
  apiKeyId: "key_abc",
  userId,
  organizationId: "organization-1",
  projectId: "project-1",
  teamId: "team-1",
});

/** The credential class that predates RBAC and carries no user at all. */
const LEGACY_KEY: RestCredentialPrincipal = { kind: "legacyProjectKey" };

/** The refusal `code` a call raised, so a test never asserts on prose. */
function refusalCode(call: () => unknown): string | undefined {
  try {
    call();
  } catch (error) {
    return (error as { code?: string }).code;
  }

  return undefined;
}

describe("resolving who a personal-workspace read answers for", () => {
  describe("given a workspace that is not one person's", () => {
    describe("when the key names a shared or team project", () => {
      it("refuses, naming the personal key it needs instead", () => {
        expect(
          refusalCode(() =>
            resolvePersonalCaller({
              project: { isPersonal: false, ownerUserId: null },
              credential: keyOf(OWNER_ID),
            }),
          ),
        ).toBe("personal_project_key_required");
      });
    });

    describe("when the project is flagged personal but names no owner", () => {
      it("refuses rather than answering for nobody", () => {
        expect(
          refusalCode(() =>
            resolvePersonalCaller({
              project: { isPersonal: true, ownerUserId: null },
              credential: keyOf(OWNER_ID),
            }),
          ),
        ).toBe("personal_project_key_required");
      });
    });
  });

  describe("given a personal workspace somebody else owns", () => {
    describe("when a user-bound key is pointed at it", () => {
      it("refuses without saying whose workspace it is", () => {
        expect(
          refusalCode(() =>
            resolvePersonalCaller({
              project: { isPersonal: true, ownerUserId: OWNER_ID },
              credential: keyOf("user_someone_else"),
            }),
          ),
        ).toBe("personal_usage_key_mismatch");
      });
    });
  });

  describe("given a personal workspace the caller owns", () => {
    describe("when the key is bound to that user", () => {
      it("answers for the owner", () => {
        expect(
          resolvePersonalCaller({
            project: { isPersonal: true, ownerUserId: OWNER_ID },
            credential: keyOf(OWNER_ID),
          }),
        ).toBe(OWNER_ID);
      });
    });

    describe("when the credential is a legacy project key", () => {
      /** @scenario "A legacy project key still answers for its workspace's owner" */
      it("answers for the owner, since a project key IS that workspace's key", () => {
        expect(
          resolvePersonalCaller({
            project: { isPersonal: true, ownerUserId: OWNER_ID },
            credential: LEGACY_KEY,
          }),
        ).toBe(OWNER_ID);
      });
    });

    describe("when the credential is a modern key belonging to no person", () => {
      /** @scenario "An ownerless service key is refused rather than answered as the owner" */
      it("refuses rather than answering as the workspace's owner", () => {
        expect(
          refusalCode(() =>
            resolvePersonalCaller({
              project: { isPersonal: true, ownerUserId: OWNER_ID },
              credential: keyOf(null),
            }),
          ),
        ).toBe("personal_usage_service_key_unsupported");
      });
    });
  });
});

describe("the key row a project credential names", () => {
  const project = {
    id: "project-1",
    name: "P",
    slug: "p",
    teamId: "team-1",
    organizationId: "organization-1",
    isPersonal: false,
    ownerUserId: null,
  };
  const key = {
    type: "apiKey",
    apiKeyId: "key_1",
    userId: "user_1",
    organizationId: "organization-1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    project,
  } satisfies RestResolvedProjectCredential;

  it.each<[string, RestResolvedProjectCredential, PrincipalRef | null]>([
    ["a project key", key, { type: "apiKey", id: "key_1" }],
    [
      "a project-bound access token",
      { type: "cliAccessToken", userId: "user_1", organizationId: "organization-1", project },
      { type: "user", id: "user_1" },
    ],
    ["a legacy project key", { type: "legacyProjectKey", project }, null],
  ])("given %s", (_label, credential, expected) => {
    expect(principalOfCredential(credential)).toEqual(expected);
  });
});
