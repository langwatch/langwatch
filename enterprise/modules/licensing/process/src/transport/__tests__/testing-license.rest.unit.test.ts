// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The testing-licence route behind its own door (ADR-180 section 2): a personal token's person
 * is asked for ops:manage on every call, a service token stands alone, and the token opens
 * nothing else. Spec: specs/self-hosting/connected-services/testing-licenses.feature
 */
import { createCanonicalFamilyErrorHandler, createRestRuntime } from "@langwatch/api/rest";
import {
  ConnectLicenseTokenMalformedError,
  TestingLicenseTokenExpiredError,
  TestingLicenseTokenInvalidError,
  TestingLicenseTokenRevokedError,
  type LicensingApi,
  type TestingLicenseIssuer,
} from "@langwatch/enterprise-licensing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it, vi } from "vitest";

import { connectHostDoor, connectHostRest } from "../connect-host.rest.ts";
import { testingLicenseDoor, testingLicenseRest } from "../testing-license.rest.ts";

const PERSONAL = "lwtl_personal";
const SERVICE = "lwtl_service";
const REVOKED = "lwtl_revoked";
const EXPIRED = "lwtl_expired";

const ISSUERS: Readonly<Record<string, TestingLicenseIssuer>> = {
  [PERSONAL]: { kind: "personal", tokenId: "token-personal", userId: "dev-1" },
  [SERVICE]: { kind: "service", tokenId: "token-service", name: "GitHub Actions" },
};

const issued = {
  licenseKey: "signed-licence",
  issuedLicenseId: "license-1",
  expiresAt: "2026-01-06T00:00:00Z",
};

async function verifyTestingLicenseToken({
  bearer,
}: {
  bearer: string | null;
}): Promise<TestingLicenseIssuer> {
  if (bearer === REVOKED) throw new TestingLicenseTokenRevokedError();
  if (bearer === EXPIRED) throw new TestingLicenseTokenExpiredError();
  const issuer = bearer === null ? undefined : ISSUERS[bearer];
  if (!issuer) throw new TestingLicenseTokenInvalidError();
  return issuer;
}

function mount({ operators }: { operators: Set<string> }) {
  const issueTestingLicense = vi.fn().mockResolvedValue(issued);
  const verifyTesting = vi.fn(verifyTestingLicenseToken);
  const verifiers = createApiFixture<LicensingApi>({
    verifyTestingLicenseToken: verifyTesting,
    verifyLicenceToken: vi.fn(async () => {
      throw new ConnectLicenseTokenMalformedError();
    }),
  });
  const asked: string[] = [];
  const authorization = {
    forRequest: () => ({
      ...restTestAuthorization().forRequest(),
      getPlatformDecision: async ({ userId }: { userId: string }) => {
        asked.push(userId);
        return { permitted: operators.has(userId) };
      },
    }),
  };
  const runtime = createRestRuntime({
    audit: { record: () => {} },
    doors: {
      testing_license_token: testingLicenseDoor.open(verifiers),
      licence_token: connectHostDoor.open(verifiers),
    },
    authorization,
    identity: {
      authenticate: () => {
        throw new Error("these routes answer behind module-bound doors");
      },
    },
  });
  const onError = createCanonicalFamilyErrorHandler({
    loggerName: "langwatch:test:testing-license",
    label: "Testing licenses",
  });
  const recordLicenseSync = vi.fn();
  const testing = runtime.mount(testingLicenseRest.router(), {
    app: () => createApiFixture<LicensingApi>({ issueTestingLicense }),
    credential: "testing_license_token",
    onError,
  });
  const connect = runtime.mount(connectHostRest.router(), {
    app: () => createApiFixture<LicensingApi>({ recordLicenseSync }),
    credential: "licence_token",
    onError,
  });
  const ask = (
    bearer: string,
    body: unknown = { instanceId: "instance-a", organizationId: "org-local" },
  ) =>
    testing.fetch(
      new Request("http://api.test/api/licensing/testing-licenses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
        body: JSON.stringify(body),
      }),
    );
  return { ask, connect, issueTestingLicense, recordLicenseSync, verifyTesting, asked };
}

describe("asking for a testing licence", () => {
  describe("given a personal token whose person holds ops permissions on Cloud", () => {
    /** @scenario "Cloud staff get a testing license with no browser step" */
    it("issues it, handing the operation the person as the issuer", async () => {
      const { ask, issueTestingLicense, asked } = mount({ operators: new Set(["dev-1"]) });

      const response = await ask(PERSONAL);

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual(issued);
      expect(asked).toEqual(["dev-1"]);
      expect(issueTestingLicense).toHaveBeenCalledWith({
        instanceId: "instance-a",
        organizationId: "org-local",
        issuer: ISSUERS[PERSONAL],
      });
    });

    /** @scenario "A testing license can be asked for a shorter or longer time, up to 30 days" */
    it("hands the asked lifetime to the operation", async () => {
      const { ask, issueTestingLicense } = mount({ operators: new Set(["dev-1"]) });

      await ask(PERSONAL, {
        instanceId: "instance-a",
        organizationId: "org-local",
        lifetimeHours: 12,
      });

      expect(issueTestingLicense).toHaveBeenCalledWith(
        expect.objectContaining({ lifetimeHours: 12 }),
      );
    });
  });

  describe("given a personal token whose person holds no ops permissions", () => {
    /** @scenario "Someone without ops permissions on Cloud gets no testing license" */
    it("is refused before the handler runs, and nothing is issued", async () => {
      const { ask, issueTestingLicense } = mount({ operators: new Set() });

      const response = await ask(PERSONAL);

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "permission_denied" });
      expect(issueTestingLicense).not.toHaveBeenCalled();
    });
  });

  describe("given a person whose ops permissions were removed after an earlier issue", () => {
    /** @scenario "Losing ops permissions stops new testing licenses" */
    it("refuses the next ask with the same token", async () => {
      const operators = new Set(["dev-1"]);
      const { ask, issueTestingLicense } = mount({ operators });
      expect((await ask(PERSONAL)).status).toBe(201);

      operators.delete("dev-1");
      const response = await ask(PERSONAL);

      expect(response.status).toBe(403);
      expect(issueTestingLicense).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a service token", () => {
    /** @scenario "CI gets a testing license through a service token" */
    it("issues it with no person present, naming the service token", async () => {
      const { ask, issueTestingLicense, asked } = mount({ operators: new Set() });

      const response = await ask(SERVICE);

      expect(response.status).toBe(201);
      expect(asked).toEqual([]);
      expect(issueTestingLicense).toHaveBeenCalledWith(
        expect.objectContaining({ issuer: ISSUERS[SERVICE] }),
      );
    });

    /** @scenario "A service token outlives the person who made it" */
    it("asks nothing of the person who made it", async () => {
      const { ask, asked } = mount({ operators: new Set() });

      expect((await ask(SERVICE)).status).toBe(201);
      expect(asked).toEqual([]);
    });
  });

  describe("given a revoked or an expired token", () => {
    /** @scenario "A revoked or expired service token issues nothing" */
    it("is refused by the token's own code and nothing is issued", async () => {
      const { ask, issueTestingLicense } = mount({ operators: new Set(["dev-1"]) });

      const revoked = await ask(REVOKED);
      const expired = await ask(EXPIRED);

      expect(revoked.status).toBe(401);
      expect(await revoked.json()).toMatchObject({ code: "testing_license_token_revoked" });
      expect(expired.status).toBe(401);
      expect(await expired.json()).toMatchObject({ code: "testing_license_token_expired" });
      expect(issueTestingLicense).not.toHaveBeenCalled();
    });
  });
});

describe("a testing licence token presented anywhere else", () => {
  describe("given the connect host's sync route", () => {
    /** @scenario "The signed-in token can only issue testing licenses" */
    it("is refused by that route's own door, which never asks the testing door", async () => {
      const { connect, recordLicenseSync, verifyTesting } = mount({
        operators: new Set(["dev-1"]),
      });

      const response = await connect.fetch(
        new Request("http://api.test/api/connect/v1/license/sync", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${PERSONAL}`,
            "x-langwatch-instance": "instance-a",
          },
          body: JSON.stringify({ version: "1.2.3", seats: { members: 1, liteMembers: 0 } }),
        }),
      );

      expect(response.status).toBe(401);
      expect(recordLicenseSync).not.toHaveBeenCalled();
      expect(verifyTesting).not.toHaveBeenCalled();
    });
  });
});
