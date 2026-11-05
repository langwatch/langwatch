// Dialling a run's call through the gateway relay, up to the bridge. The bridge and the claim run
// end to end in voice-call-relay.service.integration.test.ts.
// @see specs/features/agents/voice-media-relay.feature
import { describe, expect, it } from "vitest";

import { MemoryTwilioCallControlChannel } from "../../../../channels/memory/memory.twilio-call-control.channel.ts";
import { MemoryVoiceMediaRelayBridgeChannel } from "../../../../channels/memory/memory.voice-media-relay-bridge.channel.ts";
import { MemoryVoiceMediaRelayChannel } from "../../../../channels/memory/memory.voice-media-relay.channel.ts";
import type {
  VoiceMediaRelayCredential,
  VoiceMediaRelayRefusal,
} from "../../../../channels/voice-media-relay.channels.ts";
import { MemoryPendingVoiceCallRepository } from "../../../../repositories/memory/memory.pending-voice-call.repository.ts";
import { MemoryScenarioCancellationRepository } from "../../../../repositories/memory/memory.scenario-cancellation.repository.ts";
import { VoiceCallClaimService } from "../voice-call-claim.service.ts";
import { VoiceCallDialService } from "../voice-call-dial.service.ts";
import { VoiceCallRelayService } from "../voice-call-relay.service.ts";

const DIAL = { projectId: "project-1", scenarioRunId: "run-1", nonce: "nonce-1", to: "+15550100" };
const CREDENTIAL: VoiceMediaRelayCredential = {
  baseUrl: "https://gateway.example.test",
  token: "lwl_synthetic-license-token",
  instanceId: "instance-a",
};

function setup(
  options: { credential?: VoiceMediaRelayCredential | null; refusal?: VoiceMediaRelayRefusal } = {},
) {
  const pending = MemoryPendingVoiceCallRepository.create();
  const callControl = MemoryTwilioCallControlChannel.create();
  const relays = MemoryVoiceMediaRelayChannel.create(
    options.refusal ? { refusal: options.refusal } : {},
  );
  const claims = VoiceCallClaimService.create({
    pending,
    cancellations: MemoryScenarioCancellationRepository.create(),
    authTokenFor: async () => "synthetic-auth-token",
    publicBaseUrl: "wss://voice.example.test",
    spawnChild: () => {
      throw new Error("no child is spawned by these tests");
    },
  });
  const bridges = MemoryVoiceMediaRelayBridgeChannel.create();
  const service = VoiceCallRelayService.create({
    relays,
    bridges,
    credentialFor: async () => (options.credential === undefined ? CREDENTIAL : options.credential),
    dialer: VoiceCallDialService.create({ pending, callControl }),
    claims,
  });
  return { pending, callControl, relays, bridges, service };
}

describe("VoiceCallRelayService", () => {
  describe("given an install with no Connect license credential", () => {
    /** @scenario "An install without a Connect license credential opens no relay and dials nothing" */
    it("opens no relay, dials nothing and says why", async () => {
      const { callControl, relays, service } = setup({ credential: null });

      await expect(service.dial(DIAL)).resolves.toEqual({
        dialed: false,
        reason: "no-relay-credential",
      });
      expect(relays.credentials).toEqual([]);
      expect(callControl.placedCalls).toEqual([]);
    });
  });

  describe("given a gateway that refuses to open a relay", () => {
    /** @scenario "A refused relay open dials nothing and reports the gateway's refusal" */
    it("dials nothing and answers the gateway's status and code", async () => {
      const refusal = { status: 403, code: "voice_relay_license_required" };
      const { callControl, pending, service } = setup({ refusal });

      await expect(service.dial(DIAL)).resolves.toEqual({
        dialed: false,
        reason: "relay-refused",
        refusal,
      });
      expect(callControl.placedCalls).toEqual([]);
      await expect(pending.peek({ scenarioRunId: "run-1", nonce: "nonce-1" })).resolves.toEqual({
        found: false,
      });
    });
  });

  describe("given an install with a Connect license credential", () => {
    /** @scenario "The call is dialled with the relay's stream URL" */
    it("opens the relay with that credential", async () => {
      const { relays, service } = setup();

      await service.dial(DIAL);

      expect(relays.credentials).toEqual([CREDENTIAL]);
    });

    it("dials Twilio with the relay's stream URL and the run's nonce", async () => {
      const { callControl, relays, service } = setup();

      await expect(service.dial(DIAL)).resolves.toEqual({ dialed: true, callSid: "CAnonce-1" });
      expect(callControl.placedCalls).toEqual([
        {
          projectId: "project-1",
          to: "+15550100",
          nonce: "nonce-1",
          streamUrl: relays.opened[0]!.streamUrl,
        },
      ]);
    });

    it("keeps the relay open for Twilio", async () => {
      const { relays, service } = setup();

      await service.dial(DIAL);

      expect(relays.opened[0]!.ended).toBeUndefined();
    });
  });

  describe("given the run's call was already dialled", () => {
    /** @scenario "A relay whose call is not dialled is closed" */
    it("answers already-dialed and closes the new relay", async () => {
      const { callControl, relays, service } = setup();
      await service.dial(DIAL);

      await expect(service.dial(DIAL)).resolves.toEqual({
        dialed: false,
        reason: "already-dialed",
      });
      expect(callControl.placedCalls).toHaveLength(1);
      expect(relays.opened[1]!.ended).toEqual({ code: 1000, reason: "voice_call_not_dialed" });
    });
  });

  describe("given a call placed through a relay", () => {
    describe("when the gateway ends the relay before Twilio joins", () => {
      /** @scenario "A relay that ends before Twilio joins bridges nothing" */
      it("bridges nothing and leaves the call pending", async () => {
        const { bridges, pending, relays, service } = setup();
        await service.dial(DIAL);

        relays.opened[0]!.end({ code: 4408, reason: "relay_expired" });
        await relays.opened[0]!.joined;

        expect(bridges.bridged).toEqual([]);
        await expect(pending.peek({ scenarioRunId: "run-1", nonce: "nonce-1" })).resolves.toEqual({
          found: true,
          call: { nonce: "nonce-1", projectId: "project-1", scenarioRunId: "run-1" },
        });
      });
    });

    describe("when Twilio joins the relay with a signature", () => {
      /** @scenario "Twilio joining the relay bridges it with Twilio's signature" */
      it("bridges the relay onto the run's door path with that signature", async () => {
        const { bridges, relays, service } = setup();
        await service.dial(DIAL);

        relays.opened[0]!.join({ twilioSignature: "c3ludGhldGlj" });
        await relays.opened[0]!.joined;
        await Promise.resolve();

        expect(bridges.bridged).toHaveLength(1);
        expect(bridges.bridged[0]).toMatchObject({
          relay: relays.opened[0],
          path: "/twilio/run-1/nonce-1",
          twilioSignature: "c3ludGhldGlj",
        });
      });
    });
  });
});
