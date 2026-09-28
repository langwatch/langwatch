/**
 * The worker's voice media door as the scenario module declares it, on a real raw-socket host.
 * @see specs/features/agents/voice-phone.feature
 */
import { request as httpRequest } from "node:http";
import { type AddressInfo, Socket } from "node:net";

import { RawSocketHost } from "@langwatch/api";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ScenarioApi, VoiceMediaUpgrade } from "@langwatch/scenario-contract";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createScenarioVoiceMediaDoor } from "../scenario-voice-media.ws.ts";

const accepted: Pick<VoiceMediaUpgrade, "nonce" | "url">[] = [];

function acceptVoiceMediaUpgrade(upgrade: VoiceMediaUpgrade): void {
  accepted.push({ nonce: upgrade.nonce, url: upgrade.url });
  if (upgrade.socket instanceof Socket) upgrade.socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
}

function send({
  port,
  path,
  method = "GET",
  upgrade = false,
}: {
  port: number;
  path: string;
  method?: string;
  upgrade?: boolean;
}): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      port,
      path,
      method,
      headers: upgrade ? { connection: "Upgrade", upgrade: "websocket" } : {},
    });
    req.on("response", (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    req.on("upgrade", (response, socket) => {
      socket.destroy();
      resolve(response.statusCode);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("the scenario voice media door", () => {
  const host = RawSocketHost.create({ port: 0 });
  let address: AddressInfo | undefined;

  function port(): number {
    if (!address) throw new Error("the door bound no port");
    return address.port;
  }

  beforeAll(async () => {
    host.mount(createScenarioVoiceMediaDoor(), () =>
      createApiFixture<ScenarioApi>({ acceptVoiceMediaUpgrade }),
    );
    address = await host.listen();
  });

  beforeEach(() => {
    accepted.length = 0;
  });

  afterAll(() => host.close());

  describe("given plain requests", () => {
    /** @scenario "The media listener answers its health check and refuses everything else" */
    it("answers the health path and not found everywhere else", async () => {
      await expect(send({ port: port(), path: "/healthz" })).resolves.toBe(200);
      for (const path of [
        "/",
        "/healthz/",
        "/healthz?probe=1",
        "/twilio",
        "/metrics",
        "/api/health",
      ]) {
        await expect(send({ port: port(), path })).resolves.toBe(404);
      }
      await expect(send({ port: port(), path: "/twilio/voice", method: "POST" })).resolves.toBe(
        404,
      );
      expect(accepted).toEqual([]);
    });

    /** @scenario "The media door refuses a plain request on the media path" */
    it("refuses a request without an upgrade on the media path", async () => {
      await expect(send({ port: port(), path: "/twilio/abc" })).resolves.toBe(404);
      expect(accepted).toEqual([]);
    });
  });

  describe("given upgrades", () => {
    /** @scenario "The media listener refuses an upgrade on a non-media path" */
    it("closes an upgrade off the media path not found, before the scenario sees it", async () => {
      for (const path of ["/elsewhere", "/healthz", "/twilio", "/twilio/abc/extra", "/twilio/"]) {
        await expect(send({ port: port(), path, upgrade: true })).resolves.toBe(404);
      }
      expect(accepted).toEqual([]);
    });

    it("hands an upgrade on the media path to the scenario with its nonce", async () => {
      await send({ port: port(), path: "/twilio/abc", upgrade: true });

      expect(accepted).toEqual([{ nonce: "abc", url: "/twilio/abc" }]);
    });
  });
});
