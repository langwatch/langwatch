// A self-hosted worker places a call through the gateway relay; Twilio dials the gateway, the relay
// is bridged into the claim, and the claimed child answers Twilio. A loopback stand-in plays the
// gateway, a Twilio-shaped client plays Twilio; signatures are synthetic.
// @see specs/features/agents/voice-media-relay.feature
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { GatewayRelayStandIn } from "../../../../channels/http/__tests__/fixtures/gateway-relay-stand-in.ts";
import { HttpVoiceMediaRelayBridgeChannel } from "../../../../channels/http/http.voice-media-relay-bridge.channel.ts";
import { HttpVoiceMediaRelayChannel } from "../../../../channels/http/http.voice-media-relay.channel.ts";
import { MemoryTwilioCallControlChannel } from "../../../../channels/memory/memory.twilio-call-control.channel.ts";
import { MemoryPendingVoiceCallRepository } from "../../../../repositories/memory/memory.pending-voice-call.repository.ts";
import { MemoryScenarioCancellationRepository } from "../../../../repositories/memory/memory.scenario-cancellation.repository.ts";
import { VoiceCallClaimService } from "../voice-call-claim.service.ts";
import { VoiceCallDialService } from "../voice-call-dial.service.ts";
import { VoiceCallRelayService } from "../voice-call-relay.service.ts";
import { frameText } from "./fixtures/frame-text.ts";

const CHILD_FIXTURE = fileURLToPath(new URL("./fixtures/voice-echo-child.ts", import.meta.url));
const TEST_TIMEOUT_MS = 15_000;
const AUTH_TOKEN = "synthetic-auth-token";
const DIAL = { projectId: "project-1", scenarioRunId: "run-a", nonce: "nonce-a", to: "+15550100" };
const KEY = { scenarioRunId: DIAL.scenarioRunId, nonce: DIAL.nonce };

let standIn: GatewayRelayStandIn;
let children: ChildProcess[];
let clients: WebSocket[];
let pending: MemoryPendingVoiceCallRepository;
let callControl: MemoryTwilioCallControlChannel;

function sign({ authToken, url }: { authToken: string; url: string }): string {
  return createHmac("sha1", authToken).update(url).digest("base64");
}

function spawnChild(): ChildProcess {
  const child = spawn(process.execPath, [CHILD_FIXTURE], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  children.push(child);
  return child;
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function exited(child: ChildProcess): Promise<void> {
  return hasExited(child)
    ? Promise.resolve()
    : new Promise((resolve) => child.once("exit", () => resolve()));
}

/** Places the run's call through a relay on the stand-in and answers the stream URL Twilio got. */
async function placeCallThroughRelay(): Promise<string> {
  const cancellations = MemoryScenarioCancellationRepository.create();
  const claims = VoiceCallClaimService.create({
    pending,
    cancellations,
    authTokenFor: async () => AUTH_TOKEN,
    publicBaseUrl: "wss://unreachable.example.test",
    spawnChild,
  });
  const service = VoiceCallRelayService.create({
    relays: HttpVoiceMediaRelayChannel.create(),
    bridges: HttpVoiceMediaRelayBridgeChannel.create(),
    credentialFor: async () => ({
      baseUrl: standIn.baseUrl,
      token: "lwl_synthetic-license-token",
      instanceId: "instance-a",
    }),
    dialer: VoiceCallDialService.create({ pending, callControl }),
    claims,
  });
  const result = await service.dial(DIAL);
  expect(result).toEqual({ dialed: true, callSid: "CAnonce-a" });
  return callControl.placedCalls[0]!.streamUrl!;
}

/** Twilio dials the stream URL it was given, signing the upgrade (if given one), and sends `start`. */
function twilioJoins({ streamUrl, signature }: { streamUrl: string; signature?: string }) {
  const headers = signature === undefined ? {} : { "x-twilio-signature": signature };
  const twilio = new WebSocket(streamUrl, { headers });
  clients.push(twilio);
  const firstMessage = new Promise<string>((resolve) =>
    twilio.once("message", (data) => resolve(frameText(data))),
  );
  const closed = new Promise<number>((resolve) => twilio.once("close", (code) => resolve(code)));
  twilio.once("open", () => twilio.send('{"event":"start"}'));
  return { twilio, firstMessage, closed };
}

async function spawnedChild(): Promise<ChildProcess> {
  const deadline = Date.now() + 5_000;
  while (children.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return children[0]!;
}

beforeEach(async () => {
  children = [];
  clients = [];
  pending = MemoryPendingVoiceCallRepository.create();
  callControl = MemoryTwilioCallControlChannel.create();
  standIn = await GatewayRelayStandIn.start();
});

afterEach(async () => {
  for (const client of clients) client.terminate();
  await Promise.all(
    children
      .filter((child) => !hasExited(child))
      .map((child) => {
        const done = exited(child);
        child.kill("SIGKILL");
        return done;
      }),
  );
  await standIn.close();
});

describe("VoiceCallRelayService through the claim", () => {
  describe("given a call placed through a relay", () => {
    describe("when Twilio joins with a signature valid for the stream URL", () => {
      /** @scenario "A relayed call with a valid signature is claimed and its media reaches the child" */
      it(
        "spawns a child whose answer reaches Twilio",
        async () => {
          const streamUrl = await placeCallThroughRelay();
          const { firstMessage } = twilioJoins({
            streamUrl,
            signature: sign({ authToken: AUTH_TOKEN, url: streamUrl }),
          });

          expect(await firstMessage).toBe('echo:{"event":"start"}');
          expect(children).toHaveLength(1);
        },
        TEST_TIMEOUT_MS,
      );

      it(
        "claims the call",
        async () => {
          const streamUrl = await placeCallThroughRelay();
          const { firstMessage } = twilioJoins({
            streamUrl,
            signature: sign({ authToken: AUTH_TOKEN, url: streamUrl }),
          });
          await firstMessage;

          await expect(pending.claim(KEY)).resolves.toEqual({ claimed: false, reason: "unknown" });
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("when Twilio joins with a signature made with another auth token", () => {
      /** @scenario "A relayed call with a bad signature is refused and leaves the call pending" */
      it(
        "closes Twilio's socket and spawns no child",
        async () => {
          const streamUrl = await placeCallThroughRelay();
          const { closed } = twilioJoins({
            streamUrl,
            signature: sign({ authToken: "another-token", url: streamUrl }),
          });

          expect(await closed).toBe(1008);
          expect(children).toHaveLength(0);
        },
        TEST_TIMEOUT_MS,
      );

      it(
        "leaves the call peekable for the claim deadline",
        async () => {
          const streamUrl = await placeCallThroughRelay();
          const { closed } = twilioJoins({
            streamUrl,
            signature: sign({ authToken: "another-token", url: streamUrl }),
          });
          await closed;

          await expect(pending.peek(KEY)).resolves.toMatchObject({ found: true });
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("when Twilio joins with no signature header", () => {
      /** @scenario "An upgrade without a signature is refused and leaves the call pending" */
      it(
        "closes Twilio's socket and spawns no child",
        async () => {
          const streamUrl = await placeCallThroughRelay();
          const { closed } = twilioJoins({ streamUrl });

          expect(await closed).toBe(1008);
          expect(children).toHaveLength(0);
        },
        TEST_TIMEOUT_MS,
      );

      it(
        "leaves the call peekable for the claim deadline",
        async () => {
          const streamUrl = await placeCallThroughRelay();
          const { closed } = twilioJoins({ streamUrl });
          await closed;

          await expect(pending.peek(KEY)).resolves.toMatchObject({ found: true });
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("when the gateway ends the relay before Twilio joins", () => {
      it(
        "spawns no child and leaves the call pending",
        async () => {
          await placeCallThroughRelay();
          const [relayId] = standIn.relayIds;
          const worker = standIn.workers.get(relayId!)!;
          const workerGone = new Promise((resolve) => worker.once("close", resolve));
          worker.close(4408, "relay_expired");
          await workerGone;
          await new Promise((resolve) => setTimeout(resolve, 200));

          expect(children).toHaveLength(0);
          await expect(pending.peek(KEY)).resolves.toMatchObject({ found: true });
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("when the bridged call's Twilio side hangs up", () => {
      /** @scenario "Twilio hanging up ends the child's media socket" */
      it(
        "ends the child",
        async () => {
          const streamUrl = await placeCallThroughRelay();
          const { twilio, firstMessage } = twilioJoins({
            streamUrl,
            signature: sign({ authToken: AUTH_TOKEN, url: streamUrl }),
          });
          await firstMessage;
          const child = await spawnedChild();

          twilio.close(1000);
          await exited(child);

          expect(hasExited(child)).toBe(true);
        },
        TEST_TIMEOUT_MS,
      );
    });
  });
});
