import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RawSocketHost, RawSocketProtocol, type RawSocketUpgrade } from "../raw-socket.ts";

type MediaApp = { received: { nonce: string | undefined; head: number }[] };

const app: MediaApp = { received: [] };

function upgradeStatus(port: number, path: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      port,
      path,
      headers: { connection: "Upgrade", upgrade: "websocket" },
    });
    req.on("response", (response) => resolve(response.statusCode));
    req.on("upgrade", (response) => resolve(response.statusCode));
    req.on("error", reject);
    req.end();
  });
}

function getStatus(port: number, path: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    httpRequest({ port, path }, (response) => {
      response.resume();
      resolve(response.statusCode);
    })
      .on("error", reject)
      .end();
  });
}

describe("RawSocketHost", () => {
  const host = RawSocketHost.create({ port: 0 });
  let address: AddressInfo | undefined;

  beforeAll(async () => {
    host.mount(
      RawSocketProtocol.create<MediaApp>({
        path: "/twilio/:nonce",
        handle: (target, upgrade: RawSocketUpgrade) => {
          target.received.push({ nonce: upgrade.params.nonce, head: upgrade.head.length });
          upgrade.socket.end("HTTP/1.1 101 Switching Protocols\r\n\r\n");
        },
      }),
      () => app,
    );
    address = await host.listen();
  });

  afterAll(() => host.close());

  describe("given a door declared at /twilio/:nonce", () => {
    /** @scenario "An upgrade on a declared pattern reaches the handler with its captured values" */
    it("hands the raw socket to the handler with the captured nonce", async () => {
      if (!address) throw new Error("the door bound no port");

      await upgradeStatus(address.port, "/twilio/abc");

      expect(app.received).toEqual([{ nonce: "abc", head: 0 }]);
    });

    /** @scenario "An upgrade no pattern matches is refused 404 and the liveness path answers" */
    it("refuses an unmatched upgrade 404 and answers the liveness path", async () => {
      if (!address) throw new Error("the door bound no port");

      await expect(upgradeStatus(address.port, "/elsewhere")).resolves.toBe(404);
      await expect(getStatus(address.port, "/healthz")).resolves.toBe(200);
    });
  });
});
