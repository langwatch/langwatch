// The worker's client of the gateway's Twilio media relay, against a stand-in that speaks the
// relay's wire protocol on loopback. No real gateway, no Twilio.
// @see specs/features/agents/voice-media-relay.feature
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { frameBytes } from "../../../rules/websocket.rules.ts";
import type { VoiceMediaRelay, VoiceMediaRelayFrame } from "../../voice-media-relay.channels.ts";
import { HttpVoiceMediaRelayChannel } from "../http.voice-media-relay.channel.ts";
import { GatewayRelayStandIn } from "./fixtures/gateway-relay-stand-in.ts";

const TOKEN = "lwl_synthetic-license-token";
const INSTANCE = "instance-a";

let standIn: GatewayRelayStandIn | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await standIn?.close();
  standIn = undefined;
});

async function openOn(gateway: GatewayRelayStandIn) {
  return HttpVoiceMediaRelayChannel.create().open({
    credential: { baseUrl: gateway.baseUrl, token: TOKEN, instanceId: INSTANCE },
  });
}

async function openedRelay(gateway: GatewayRelayStandIn): Promise<VoiceMediaRelay> {
  const result = await openOn(gateway);
  if (!result.opened) throw new Error(`relay open refused: ${JSON.stringify(result.refusal)}`);
  return result.relay;
}

/** Connects a Twilio-shaped client to the relay's stream URL. */
function joinAsTwilio({ relay, signature }: { relay: VoiceMediaRelay; signature?: string }) {
  const twilio = new WebSocket(relay.streamUrl, {
    headers: signature === undefined ? {} : { "x-twilio-signature": signature },
  });
  sockets.push(twilio);
  return new Promise<WebSocket>((resolve, reject) => {
    twilio.once("open", () => resolve(twilio));
    twilio.once("error", reject);
  });
}

describe("HttpVoiceMediaRelayChannel", () => {
  describe("given a gateway that answers a relay open with a ready frame", () => {
    let gateway: GatewayRelayStandIn;
    let relay: VoiceMediaRelay;

    beforeEach(async () => {
      gateway = standIn = await GatewayRelayStandIn.start();
      relay = await openedRelay(gateway);
    });

    /** @scenario "The relay is opened with the install's license token and instance id" */
    it("presents the license token and instance id on the upgrade", () => {
      expect(gateway.opens).toHaveLength(1);
      expect(gateway.opens[0]).toMatchObject({
        authorization: `Bearer ${TOKEN}`,
        "x-langwatch-instance": INSTANCE,
      });
    });

    it("answers the stream URL on the gateway's origin and the ready frame's path", () => {
      const [relayId] = gateway.relayIds;
      expect(relay.streamUrl).toBe(
        `${gateway.baseUrl.replace("http:", "ws:")}/v1/voice/twilio/${relayId}`,
      );
      expect(relay.logId).toBe(relayId!.slice(0, 8));
    });

    describe("when the gateway ends the relay before Twilio joins", () => {
      it("settles the join as ended, with the gateway's close code", async () => {
        gateway.workers.get(gateway.relayIds[0]!)!.close(4408, "relay_expired");

        await expect(relay.joined).resolves.toEqual({
          joined: false,
          end: { code: 4408, reason: "relay_expired" },
        });
      });
    });

    describe("when Twilio joins with a signature", () => {
      let twilio: WebSocket;

      beforeEach(async () => {
        twilio = await joinAsTwilio({ relay, signature: "c3ludGhldGlj" });
        await relay.joined;
      });

      /** @scenario "Twilio's frames reach the worker after the joined notice, in order" */
      it("reports the join with Twilio's signature", async () => {
        await expect(relay.joined).resolves.toEqual({
          joined: true,
          twilioSignature: "c3ludGhldGlj",
        });
      });

      it("replays frames that came before the worker listened, then the rest, in order", async () => {
        twilio.send('{"event":"connected"}');
        twilio.send(Buffer.from([1, 2, 3]), { binary: true });
        await new Promise((resolve) => setTimeout(resolve, 100));

        const received: VoiceMediaRelayFrame[] = [];
        const allThree = new Promise<void>((resolve) =>
          relay.onFrame((frame) => {
            received.push(frame);
            if (received.length === 3) resolve();
          }),
        );
        twilio.send('{"event":"start"}');
        await allThree;

        expect(received.map((frame) => [frame.data.toString("hex"), frame.isBinary])).toEqual([
          [Buffer.from('{"event":"connected"}').toString("hex"), false],
          ["010203", true],
          [Buffer.from('{"event":"start"}').toString("hex"), false],
        ]);
      });

      it("sends the worker's frames to Twilio", async () => {
        const heard = new Promise<string>((resolve) =>
          twilio.once("message", (data) => resolve(frameBytes(data).toString("utf8"))),
        );

        relay.send({ data: Buffer.from('{"event":"media"}'), isBinary: false });

        expect(await heard).toBe('{"event":"media"}');
      });

      it("reports the end with Twilio's close code", async () => {
        const ended = new Promise((resolve) => relay.onEnd(resolve));

        twilio.close(4502, "");

        expect(await ended).toMatchObject({ code: 4502 });
      });

      /** @scenario "A transient socket error after open does not terminate an active relay" */
      it("keeps relaying frames after a socket error fires once the relay is open", async () => {
        // The opening handshake listens for "error" on the socket to refuse an unopened relay.
        // That listener must not outlive the handshake, or a later, unrelated error on the same
        // socket would terminate an already-paired call.
        (relay as VoiceMediaRelay & { socket: WebSocket }).socket.emit("error", new Error("transient"));

        const heard = new Promise<string>((resolve) =>
          twilio.once("message", (data) => resolve(frameBytes(data).toString("utf8"))),
        );
        relay.send({ data: Buffer.from('{"event":"media"}'), isBinary: false });

        expect(await heard).toBe('{"event":"media"}');
      });
    });
  });

  describe("given a gateway that refuses the open with 403", () => {
    /** @scenario "A refused relay open reports the gateway's status and error code" */
    it("is refused with the status and the gateway's error code", async () => {
      standIn = await GatewayRelayStandIn.start({
        refuse: { status: 403, code: "voice_relay_license_required" },
      });

      await expect(openOn(standIn)).resolves.toEqual({
        opened: false,
        refusal: { status: 403, code: "voice_relay_license_required" },
      });
    });
  });

  describe("given a gateway whose first frame is not the ready frame", () => {
    /** @scenario "A relay that does not start with a ready frame is refused" */
    it("is refused as a protocol error", async () => {
      standIn = await GatewayRelayStandIn.start({ firstFrame: '{"event":"something.else"}' });

      await expect(openOn(standIn)).resolves.toEqual({
        opened: false,
        refusal: { status: 0, code: "relay_protocol_error" },
      });
    });
  });
});
