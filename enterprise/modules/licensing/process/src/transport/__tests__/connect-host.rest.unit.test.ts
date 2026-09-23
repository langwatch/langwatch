// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The connect host's routes and the install's parser, end to end: a refusal
 * thrown as a HandledError crosses the standard REST body and arrives on the
 * install as the same code. Spec: specs/self-hosting/connected-services/
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { createCanonicalFamilyErrorHandler, createRestRuntime } from "@langwatch/api/rest";
import {
  ConnectLicenseRevokedError,
  LicenseSyncRateLimitedError,
  type LicensingApi,
} from "@langwatch/enterprise-licensing-contract";
import { describe, expect, it, vi } from "vitest";

import { HttpConnectLicenseChannel } from "../../channels/http/http.connect-license.channel.ts";
import { connectHostRest } from "../connect-host.rest.ts";

const TOKEN = `lwl_${"a".repeat(64)}`;
const credential = { token: TOKEN, instanceId: "install-1" };
const seats = { members: 12, liteMembers: 3 };

function mount(app: Partial<LicensingApi>) {
  const hono = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("the connect host reads its own bearer");
      },
    },
  }).mount(connectHostRest.router(), {
    app: () => createApiFixture<LicensingApi>(app),
    credential: "public",
    onError: createCanonicalFamilyErrorHandler({
      loggerName: "langwatch:test:connect-host",
      label: "Connect host",
    }),
  });
  // `connect.langwatch.ai/v1/*` is `/api/v1/connect/*` on the app.
  const channel = HttpConnectLicenseChannel.create({
    endpoint: "https://connect.test",
    fetch: async (url, init) =>
      hono.fetch(
        new Request(
          url.replace("https://connect.test/v1/", "http://api.test/api/v1/connect/"),
          init,
        ),
      ),
  });
  return { hono, channel };
}

describe("the connect host", () => {
  describe("when a sync is accepted", () => {
    /** @scenario "A sync records the reported seats and answers with the entitled services" */
    it("passes the presented bearer and instance through and answers the services", async () => {
      const recordLicenseSync = vi.fn().mockResolvedValue({ services: ["instant_evals"] });
      const { channel } = mount({ recordLicenseSync });

      await expect(channel.syncLicense({ credential, version: "1.2.3", seats })).resolves.toEqual({
        services: ["instant_evals"],
      });
      expect(recordLicenseSync).toHaveBeenCalledWith({
        authorization: `Bearer ${TOKEN}`,
        instanceId: "install-1",
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
        new Request("http://api.test/api/v1/connect/license/sync", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
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
        new Request("http://api.test/api/v1/connect/license/sync", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify({ version: "1.2.3", seats, organizationName: "ACME" }),
        }),
      );

      expect(await response.json()).toMatchObject({ code: "validation_error" });
      expect(recordLicenseSync).not.toHaveBeenCalled();
    });
  });

  describe("when an activation code is redeemed", () => {
    it("answers the minted license to the install", async () => {
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
      expect(redeemActivationCode).toHaveBeenCalledWith({
        authorization: "Bearer LW-ABCD",
        instanceId: "install-1",
      });
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
