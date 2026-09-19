/**
 * What the install sends when its license syncs, and what it reads back.
 *
 * Driven through undici's `MockAgent` as the dispatcher, so the real request
 * is built and the real response handling runs, and only the socket is
 * replaced.
 *
 * @see ../connectLicenseClient.ts
 * @see specs/self-hosting/connected-services/license-sync.feature
 */

import { MockAgent } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConnectLicenseClient } from "../connectLicenseClient";
import { credentialOf, LICENSE, leaseFor } from "./installFakes";

const ENDPOINT = "https://connect.example.test";
const CREDENTIAL = credentialOf(LICENSE.licenseKey);
const LEASE = leaseFor();

let agent: MockAgent;

function client() {
  return new ConnectLicenseClient({ endpoint: ENDPOINT, dispatcher: agent });
}

function sync() {
  return client().syncLicense({
    credential: CREDENTIAL,
    version: "3.17.0",
    seats: { members: 53, liteMembers: 4 },
  });
}

function refusal(code: string) {
  return {
    error: { type: code, code, message: `the host refused with ${code}` },
  };
}

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});

afterEach(async () => {
  await agent.close();
});

describe("given a connect host that answers", () => {
  describe("when the license syncs", () => {
    /** @scenario "The sync sends the fixed license payload and nothing else" */
    it("sends the token, the instance id, the version and the two seat counts", async () => {
      let sentHeaders: Record<string, string> = {};
      let sentBody = "";
      agent
        .get(ENDPOINT)
        .intercept({ path: "/v1/license/sync", method: "POST" })
        .reply(200, (options) => {
          sentHeaders = options.headers as Record<string, string>;
          sentBody = String(options.body);
          return { lease: LEASE };
        });

      await sync();

      expect(sentHeaders.authorization).toBe(`Bearer ${CREDENTIAL.token}`);
      expect(sentHeaders["x-langwatch-instance"]).toBe(CREDENTIAL.instanceId);
      expect(JSON.parse(sentBody)).toEqual({
        version: "3.17.0",
        seats: { members: 53, liteMembers: 4 },
      });
    });

    /** @scenario "The sync sends the fixed license payload and nothing else" */
    it("sends no organization name, no hostname, no user data and no statistics", async () => {
      let sentBody = "";
      agent
        .get(ENDPOINT)
        .intercept({ path: "/v1/license/sync", method: "POST" })
        .reply(200, (options) => {
          sentBody = String(options.body);
          return { lease: LEASE };
        });

      await sync();

      expect(Object.keys(JSON.parse(sentBody)).sort()).toEqual([
        "seats",
        "version",
      ]);
    });

    it("reads the signed lease back as it was sent", async () => {
      agent
        .get(ENDPOINT)
        .intercept({ path: "/v1/license/sync", method: "POST" })
        .reply(200, { lease: LEASE });

      const answer = await sync();

      expect(answer.lease).toEqual(LEASE);
      expect(answer.license).toBeUndefined();
    });

    it("reads a reissued license the answer carries", async () => {
      agent
        .get(ENDPOINT)
        .intercept({ path: "/v1/license/sync", method: "POST" })
        .reply(200, { lease: LEASE, license: "lw-reissued-key" });

      const answer = await sync();

      expect(answer.license).toBe("lw-reissued-key");
    });
  });
});

describe("given a connect host that refuses", () => {
  describe("when the license is not registered or is bound elsewhere", () => {
    /** @scenario "A sync from an unregistered, revoked or wrong-instance license is refused" */
    it("keeps the code the host named", async () => {
      agent
        .get(ENDPOINT)
        .intercept({ path: "/v1/license/sync", method: "POST" })
        .reply(403, refusal("connect_wrong_instance"));

      await expect(sync()).rejects.toMatchObject({
        code: "connect_wrong_instance",
      });
    });
  });

  describe("when the license syncs too often", () => {
    /** @scenario "Sync is rate limited per license" */
    it("keeps the too-many-requests code", async () => {
      agent
        .get(ENDPOINT)
        .intercept({ path: "/v1/license/sync", method: "POST" })
        .reply(429, refusal("rate_limited"));

      await expect(sync()).rejects.toMatchObject({ code: "rate_limited" });
    });
  });

  describe("when the answer is not the published shape", () => {
    it("is reported as the host not answering with a result", async () => {
      agent
        .get(ENDPOINT)
        .intercept({ path: "/v1/license/sync", method: "POST" })
        .reply(200, { lease: { payload: { licenseId: "lic-1" } } });

      await expect(sync()).rejects.toMatchObject({
        code: "hosted_service_unavailable",
      });
    });
  });
});

describe("given a connect host that cannot be reached", () => {
  describe("when the license syncs", () => {
    it("names the host and the port an outbound rule has to allow", async () => {
      agent
        .get(ENDPOINT)
        .intercept({ path: "/v1/license/sync", method: "POST" })
        .replyWithError(new Error("ECONNREFUSED"));

      await expect(sync()).rejects.toMatchObject({
        code: "connect_unreachable",
        meta: { host: "connect.example.test", port: 443 },
      });
    });
  });
});
