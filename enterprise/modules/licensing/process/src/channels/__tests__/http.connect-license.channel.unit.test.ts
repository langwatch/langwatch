/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/license-sync.feature
 *
 * What the install sends when its license syncs, and what it reads back.
 */
import type { ConnectCredential } from "@langwatch/enterprise-licensing-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { HttpConnectLicenseChannel } from "../http/http.connect-license.channel.ts";
import { hostRefusal, ScriptedConnectHost } from "./support/scripted-connect-fetch.ts";

const ENDPOINT = "https://connect.example.test";
const SERVICES = ["instant_evals"];

const CREDENTIAL: ConnectCredential = {
  token: "lwl_".padEnd(68, "b"),
  instanceId: "3f1c2b40-9a7e-4f2a-8f4c-6b1f0c2d9e77",
};

let host: ScriptedConnectHost;

function sync() {
  return HttpConnectLicenseChannel.create({ endpoint: ENDPOINT, fetch: host.fetch }).syncLicense({
    credential: CREDENTIAL,
    version: "3.17.0",
    seats: { members: 53, liteMembers: 4 },
  });
}

beforeEach(() => {
  host = new ScriptedConnectHost();
});

describe("given a connect host that answers", () => {
  describe("when the license syncs", () => {
    /** @scenario "The sync sends the fixed license payload and nothing else" */
    it("sends the token, the instance id, the version and the two seat counts, and nothing else", async () => {
      host.answers(200, { services: SERVICES });

      await sync();

      expect(host.sent).toHaveLength(1);
      expect(host.sent[0]).toMatchObject({
        url: `${ENDPOINT}/v1/license/sync`,
        method: "POST",
        body: { version: "3.17.0", seats: { members: 53, liteMembers: 4 } },
      });
      expect(host.sent[0]?.headers).toMatchObject({
        authorization: `Bearer ${CREDENTIAL.token}`,
        "x-langwatch-instance": CREDENTIAL.instanceId,
      });
      expect(Object.keys(Object(host.sent[0]?.body)).toSorted()).toEqual(["seats", "version"]);
    });

    it("reads the entitled services back as they were sent", async () => {
      host.answers(200, { services: SERVICES });

      const answer = await sync();

      expect(answer.services).toEqual(SERVICES);
      expect(answer.license).toBeUndefined();
    });

    it("reads a reissued license the answer carries", async () => {
      host.answers(200, { services: SERVICES, license: "lw-reissued-key" });

      await expect(sync()).resolves.toMatchObject({ license: "lw-reissued-key" });
    });
  });
});

describe("given a connect host that refuses", () => {
  it("keeps the code the host named for a license bound elsewhere", async () => {
    host.answers(403, hostRefusal("connect_wrong_instance"));

    await expect(sync()).rejects.toMatchObject({ code: "connect_wrong_instance" });
  });

  it("keeps the too-many-requests code", async () => {
    host.answers(429, hostRefusal("rate_limited"));

    await expect(sync()).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("reads an answer outside the published shape as the host not answering", async () => {
    host.answers(200, { services: "instant_evals" });

    await expect(sync()).rejects.toMatchObject({ code: "hosted_service_unavailable" });
  });
});

describe("given a connect host that cannot be reached", () => {
  it("names the host and the port an outbound rule has to allow", async () => {
    host.cannotBeReached();

    await expect(sync()).rejects.toMatchObject({
      code: "connect_unreachable",
      meta: { host: "connect.example.test", port: 443 },
    });
  });
});
