import type { ApiKeyApi, ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
/**
 * The legacy `X-Auth-Token` check: the project a token names, counted per caller first.
 * @see specs/auth/auth-rest-family-mounted.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ProjectAuthTokenService } from "../project-auth-token.service.ts";

const ACME: ResolvedApiKeyCredential = {
  type: "legacyProjectKey",
  project: {
    id: "project-1",
    name: "Acme",
    slug: "acme",
    teamId: "team-1",
    organizationId: "org-1",
    isPersonal: false,
    ownerUserId: null,
  },
};

function tokenCheck(resolved: ResolvedApiKeyCredential | null) {
  const counted: string[] = [];
  const service = ProjectAuthTokenService.create({
    apiKeys: createApiFixture<ApiKeyApi>({ findResolvedToken: async () => resolved }),
    rateLimiter: {
      check: async (key) => {
        counted.push(key);
        return { allowed: true };
      },
    },
  });

  return { service, counted };
}

describe("ProjectAuthTokenService", () => {
  describe("when a token names a project", () => {
    it("answers its slug, counted against the caller's nearest forwarding hop", async () => {
      const { service, counted } = tokenCheck(ACME);

      await expect(
        service.validateProjectAuthToken({ token: "tok", forwardedFor: "1.1.1.1, 2.2.2.2" }),
      ).resolves.toEqual({ projectSlug: "acme" });
      expect(counted).toEqual(["auth-validate:ip:2.2.2.2"]);
    });

    it("counts a caller that named no hop as unknown rather than skipping the count", async () => {
      const { service, counted } = tokenCheck(ACME);

      await service.validateProjectAuthToken({ token: "tok", forwardedFor: undefined });

      expect(counted).toEqual(["auth-validate:ip:unknown"]);
    });
  });

  describe("when the request carries no token", () => {
    it("refuses with the handled 401 before counting anything", async () => {
      const { service, counted } = tokenCheck(ACME);

      await expect(
        service.validateProjectAuthToken({ token: undefined, forwardedFor: undefined }),
      ).rejects.toMatchObject({ code: "missing_credentials", httpStatus: 401 });
      expect(counted).toEqual([]);
    });
  });

  describe("when the token names no project", () => {
    it("refuses with the handled 401", async () => {
      const { service } = tokenCheck(null);

      await expect(
        service.validateProjectAuthToken({ token: "tok", forwardedFor: undefined }),
      ).rejects.toMatchObject({ code: "invalid_credentials", httpStatus: 401 });
    });
  });
});
