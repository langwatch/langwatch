import { createCanonicalFamilyErrorHandler, createRestRuntime } from "@langwatch/api/rest";
import {
  ActivationCodeAlreadyRedeemedError,
  ActivationCodeExpiredError,
  ActivationCodeNotFoundError,
  ConnectInstanceRequiredError,
  ConnectLicenseRevokedError,
  ConnectLicenseTokenMalformedError,
  LicenseSyncRateLimitedError,
  type ConnectPresentedCredential,
  type LicensingApi,
} from "@langwatch/enterprise-licensing-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The connect host's routes and the install's parser, end to end: a refusal
 * thrown as a HandledError crosses the standard REST body and arrives on the
 * install as the same code. Spec: specs/self-hosting/connected-services/
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it, vi } from "vitest";

import { HttpConnectLicenseChannel } from "../../channels/http/http.connect-license.channel.ts";
import {
  connectHostDoor,
  connectHostRest,
  type ConnectBearerVerifiers,
} from "../connect-host.rest.ts";

const TOKEN = `lwl_${"a".repeat(64)}`;
const credential = { token: TOKEN, instanceId: "install-1" };
const seats = { members: 12, liteMembers: 3 };
const licenceCaller = {
  licenseRowId: "license-1",
  organizationId: "organization-1",
  instanceId: "install-1",
  virtualKeyId: "vk-1",
};
const activationCaller = {
  activationCodeId: "code-1",
  organizationId: "organization-1",
  instanceId: "install-1",
};

/** The door's checks as the services answer them: a refusal is thrown by its own code. */
const accepting: ConnectBearerVerifiers = {
  verifyLicenceToken: async ({ authorization, instanceId }: ConnectPresentedCredential) => {
    if (authorization !== `Bearer ${TOKEN}`) throw new ConnectLicenseTokenMalformedError();
    if (!instanceId) throw new ConnectInstanceRequiredError();
    return licenceCaller;
  },
  verifyActivationCode: async ({ authorization }: ConnectPresentedCredential) => {
    if (authorization === "Bearer LW-REVOKED") throw new ActivationCodeNotFoundError();
    if (authorization === "Bearer LW-EXPIRED") throw new ActivationCodeExpiredError();
    return activationCaller;
  },
};

function mount(app: Partial<LicensingApi>, verifiers: ConnectBearerVerifiers = accepting) {
  const hono = createRestRuntime({
    doors: { licence_token: connectHostDoor(verifiers) },
    authorization: restTestAuthorization(),
    identity: {
      authenticate: () => {
        throw new Error("the connect host's bearer is the licence_token door's");
      },
    },
  }).mount(connectHostRest.router(), {
    app: () => createApiFixture<LicensingApi>(app),
    credential: "licence_token",
    onError: createCanonicalFamilyErrorHandler({
      loggerName: "langwatch:test:connect-host",
      label: "Connect host",
    }),
  });
  // `connect.langwatch.ai/v1/*` is `/api/connect/v1/*` on the app, as on main.
  const channel = HttpConnectLicenseChannel.create({
    endpoint: "https://connect.test",
    fetch: async (url, init) =>
      hono.fetch(
        new Request(
          url.replace("https://connect.test/v1/", "http://api.test/api/connect/v1/"),
          init,
        ),
      ),
  });
  return { hono, channel };
}

describe("the connect host", () => {
  describe("when a sync is accepted", () => {
    /** @scenario "A sync records the reported seats and answers with the entitled services" */
    it("hands the operation the caller the door verified and answers the services", async () => {
      const recordLicenseSync = vi.fn().mockResolvedValue({ services: ["instant_evals"] });
      const { channel } = mount({ recordLicenseSync });

      await expect(channel.syncLicense({ credential, version: "1.2.3", seats })).resolves.toEqual({
        services: ["instant_evals"],
      });
      expect(recordLicenseSync).toHaveBeenCalledWith({
        caller: licenceCaller,
        body: { version: "1.2.3", seats },
      });
    });
  });

  describe("when a sync is refused", () => {
    /** @scenario "A sync from an unregistered, revoked or wrong-instance license is refused" */
    it("answers the standard body, which the install reads back as the same code", async () => {
      const { hono, channel } = mount({
        recordLicenseSync: () => Promise.reject(new ConnectLicenseRevokedError()),
      });

      const response = await hono.fetch(
        new Request("http://api.test/api/connect/v1/license/sync", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${TOKEN}`,
            "x-langwatch-instance": "install-1",
          },
          body: JSON.stringify({ version: "1.2.3", seats }),
        }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "connect_license_revoked" });

      await expect(
        channel.syncLicense({ credential, version: "1.2.3", seats }),
      ).rejects.toMatchObject({ code: "connect_license_revoked" });
    });

    /** @scenario "Sync is rate limited per license" */
    it("carries the rate limit through as its own code", async () => {
      const { channel } = mount({
        recordLicenseSync: () => Promise.reject(new LicenseSyncRateLimitedError()),
      });

      await expect(
        channel.syncLicense({ credential, version: "1.2.3", seats }),
      ).rejects.toMatchObject({ code: "rate_limited" });
    });

    /** @scenario "A sync with a malformed payload is refused" */
    it("refuses a payload carrying anything but the version and the seats before the app runs", async () => {
      const recordLicenseSync = vi.fn();
      const { hono } = mount({ recordLicenseSync });

      const response = await hono.fetch(
        new Request("http://api.test/api/connect/v1/license/sync", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${TOKEN}`,
            "x-langwatch-instance": "install-1",
          },
          body: JSON.stringify({ version: "1.2.3", seats, organizationName: "ACME" }),
        }),
      );

      expect(await response.json()).toMatchObject({ code: "validation_error" });
      expect(recordLicenseSync).not.toHaveBeenCalled();
    });
  });

  describe("when a sync presents a credential the door refuses", () => {
    const sync = (headers: Record<string, string>) =>
      new Request("http://api.test/api/connect/v1/license/sync", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: "{not json",
      });

    /** @scenario "The connect host's door refuses a malformed licence token before the body" */
    it("answers connect_license_token_malformed with 401, the operation never runs", async () => {
      const recordLicenseSync = vi.fn();
      const { hono } = mount({ recordLicenseSync });

      for (const authorization of ["Bearer LW-ABCD", "lwl_unprefixed"]) {
        const response = await hono.fetch(
          sync({ authorization, "x-langwatch-instance": "install-1" }),
        );
        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({ code: "connect_license_token_malformed" });
      }
      const bare = await hono.fetch(sync({ "x-langwatch-instance": "install-1" }));
      expect(bare.status).toBe(401);
      expect(await bare.json()).toMatchObject({ code: "connect_license_token_malformed" });
      expect(recordLicenseSync).not.toHaveBeenCalled();
    });

    /** @scenario "The connect host's door refuses a licence token presented without an instance id" */
    it("answers connect_instance_required with 400, the operation never runs", async () => {
      const recordLicenseSync = vi.fn();
      const { hono } = mount({ recordLicenseSync });

      const response = await hono.fetch(sync({ authorization: `Bearer ${TOKEN}` }));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "connect_instance_required" });
      expect(recordLicenseSync).not.toHaveBeenCalled();
    });
  });

  describe("when an activation code is redeemed", () => {
    /** @scenario "The connect host's door finds the code and the redemption claims it" */
    it("hands the redemption the code the door found and answers the minted license", async () => {
      const answer = {
        license: "signed-license",
        planType: "ENTERPRISE",
        maxMembers: 20,
        expiresAt: "2027-01-01T00:00:00.000Z",
        services: ["instant_evals"],
      };
      const redeemActivationCode = vi.fn().mockResolvedValue(answer);
      const { channel } = mount({ redeemActivationCode });

      await expect(channel.activate({ code: "LW-ABCD", instanceId: "install-1" })).resolves.toEqual(
        answer,
      );
      expect(redeemActivationCode).toHaveBeenCalledWith(activationCaller);
    });
  });

  describe("when an activation code is refused", () => {
    const activate = (code: string) =>
      new Request("http://api.test/api/connect/v1/license/activate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${code}`,
          "x-langwatch-instance": "install-1",
        },
        body: "{}",
      });

    /** @scenario "A revoked, expired or already redeemed code is refused at the connect host with its own code" */
    it("refuses a revoked or expired code at the door, before the redemption runs", async () => {
      const redeemActivationCode = vi.fn();
      const { hono } = mount({ redeemActivationCode });

      const revoked = await hono.fetch(activate("LW-REVOKED"));
      expect(revoked.status).toBe(401);
      expect(await revoked.json()).toMatchObject({ code: "activation_code_not_found" });

      const expired = await hono.fetch(activate("LW-EXPIRED"));
      expect(expired.status).toBe(403);
      expect(await expired.json()).toMatchObject({ code: "activation_code_expired" });

      expect(redeemActivationCode).not.toHaveBeenCalled();
    });

    /** @scenario "A revoked, expired or already redeemed code is refused at the connect host with its own code" */
    it("answers a code another install claimed first with the claim's own refusal", async () => {
      const { hono } = mount({
        redeemActivationCode: () => Promise.reject(new ActivationCodeAlreadyRedeemedError()),
      });

      const response = await hono.fetch(activate("LW-ABCD"));

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "activation_code_already_redeemed" });
    });
  });
});

describe("the install's parser", () => {
  it("still reads the gateway's nested refusal as its code", async () => {
    const channel = HttpConnectLicenseChannel.create({
      endpoint: "https://gateway.test",
      fetch: async () =>
        Response.json(
          {
            error: {
              type: "connect_wrong_instance",
              code: "connect_wrong_instance",
              message: "no",
            },
          },
          { status: 403 },
        ),
    });

    await expect(
      channel.syncLicense({ credential, version: "1.2.3", seats }),
    ).rejects.toMatchObject({
      code: "connect_wrong_instance",
    });
  });
});
