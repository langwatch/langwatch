/**
 * @vitest-environment node
 *
 * The two accessors a handler asks a second permission question with: both
 * refuse an unauthenticated request rather than widening the answer.
 */

import {
  credentialPrincipalOf,
  organizationCredentialPrincipalOf,
  organizationCredentialPrincipalOfToken,
} from "@langwatch/api/rest";
import type { Context } from "hono";
import { describe, expect, it } from "vitest";

/** A context that answers only what the middleware installed. */
const contextWith = (variables: Record<string, unknown>): Context =>
  ({ get: (key: string) => variables[key] }) as unknown as Context;

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
