/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/connect-settings.feature
 *
 * A real loopback server stands in for the deployment's proxy and for the host
 * behind it, so the request leaves through the dispatcher the module builds.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { parseOutboundProxyConfig } from "@langwatch/egress";
import type { ConnectCredential } from "@langwatch/enterprise-licensing-contract";
import { afterEach, describe, expect, it } from "vitest";

import { HttpConnectGatewayChannel } from "../http/http.connect-gateway.channel.ts";
import { connectTransportFor, dispatcherOf } from "../http/http.connect-host.channel.ts";

const CREDENTIAL: ConnectCredential = {
  token: "lwl_".padEnd(68, "a"),
  instanceId: "3f1c2b40-9a7e-4f2a-8f4c-6b1f0c2d9e77",
};

const CLASSIFY_ANSWER = {
  verdicts: [{ questionId: "annoyed", probability: 0.82 }],
  input_tokens: 140,
  is_text_truncated: false,
  charged_usd: 0.000_01,
};

/** What a listening server was asked, as the wire carried it. */
type Seen = { target: string; authorization: string | undefined };

const servers: Server[] = [];

async function listen(seen: Seen[]): Promise<string> {
  const server = createServer((request: IncomingMessage, response) => {
    seen.push({ target: request.url ?? "", authorization: request.headers.authorization });
    request.resume();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(CLASSIFY_ANSWER));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function judge({
  endpoint,
  environment,
}: {
  endpoint: string;
  environment: Record<string, string>;
}) {
  const transport = connectTransportFor({
    outboundProxy: parseOutboundProxyConfig(environment),
  });
  return HttpConnectGatewayChannel.create({ endpoint, ...dispatcherOf(transport) })
    .classify({ credential: CREDENTIAL, text: "the customer wrote in", questions: [] })
    .finally(() => (transport.via === "proxy" ? transport.dispatcher.close() : void 0));
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe("given a deployment that sets an HTTP proxy", () => {
  describe("when an eval function is judged through the hosted service", () => {
    /** @scenario "Hosted calls go through the configured outbound proxy" */
    it("sends the request to the proxy, addressed to the hosted host", async () => {
      const seen: Seen[] = [];
      const proxy = await listen(seen);

      const answer = await judge({
        endpoint: "http://gateway.hosted.test",
        environment: { HTTP_PROXY: `http://${proxy}` },
      });

      expect(seen).toEqual([
        {
          target: "http://gateway.hosted.test/v1/instant-evals/classify",
          authorization: `Bearer ${CREDENTIAL.token}`,
        },
      ]);
      expect(answer.verdicts).toEqual(CLASSIFY_ANSWER.verdicts);
    });

    it("leaves a host named by NO_PROXY to be called directly", async () => {
      const throughProxy: Seen[] = [];
      const direct: Seen[] = [];
      const proxy = await listen(throughProxy);
      const host = await listen(direct);

      await judge({
        endpoint: `http://${host}`,
        environment: { HTTP_PROXY: `http://${proxy}`, NO_PROXY: "127.0.0.1" },
      });

      expect(throughProxy).toEqual([]);
      expect(direct.map((request) => request.target)).toEqual(["/v1/instant-evals/classify"]);
    });
  });
});

describe("given a deployment that names no proxy", () => {
  it("calls the hosted host directly", async () => {
    const direct: Seen[] = [];
    const host = await listen(direct);

    await judge({ endpoint: `http://${host}`, environment: {} });

    expect(direct.map((request) => request.target)).toEqual(["/v1/instant-evals/classify"]);
  });
});
