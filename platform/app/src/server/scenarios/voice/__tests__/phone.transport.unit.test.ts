/**
 * @see specs/features/agents/voice-phone.feature
 */

import { describe, expect, it, vi } from "vitest";

import { VOICE_PHONE_MAX_CALL_DURATION_SECONDS } from "~/server/agents/voice/voice-phone-config";
import {
  createPhoneTransport,
  PHONE_TRANSPORT_UNAVAILABLE_MESSAGE,
  type TwilioAdapterLike,
  type TwilioAgentFactory,
  VoicePhoneTransportUnavailableError,
} from "../transports/phone.transport";

const TWILIO_ENV: NodeJS.ProcessEnv = {
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_AUTH_TOKEN: "tok",
  TWILIO_PHONE_NUMBER: "+14155550000",
  VOICE_PUBLIC_BASE_URL: "https://voice.example.com",
};

const TARGET = "+14155550123";

/** A fake Twilio adapter that records the calls the runner makes on it, so a
 *  test asserts dial/cap/teardown without a live Twilio account. */
function fakeAdapter(): TwilioAdapterLike & {
  connectCount: number;
  placeCallArgs: Parameters<TwilioAdapterLike["placeCall"]>[0][];
  disconnectCount: number;
} {
  return {
    connectCount: 0,
    placeCallArgs: [],
    disconnectCount: 0,
    responseTimeout: 600,
    async connect() {
      this.connectCount += 1;
    },
    async disconnect() {
      this.disconnectCount += 1;
    },
    async placeCall(args) {
      this.placeCallArgs.push(args);
    },
  };
}

function factoryReturning(adapter: TwilioAdapterLike): TwilioAgentFactory {
  return () => adapter;
}

describe("phoneTransport (Twilio runner)", () => {
  describe("given phone targets have no browser call", () => {
    /** @scenario "A phone target has no browser call" */
    it("throws rather than minting a browser session", () => {
      const runner = createPhoneTransport({ env: TWILIO_ENV });
      const mint = () =>
        runner.mintSession({
          agentId: TARGET,
          credential: { apiKey: "", baseUrl: "" },
        });
      expect(mint).toThrow(VoicePhoneTransportUnavailableError);
    });
  });

  describe("given Twilio is not configured on the deployment", () => {
    /** @scenario "A phone run fails closed when Twilio is not configured" */
    it("fails closed with the phone-unavailable message when building the adapter", () => {
      const runner = createPhoneTransport({ env: {} });
      const build = () =>
        runner.createAgentAdapter({
          agentId: TARGET,
          credential: { apiKey: "", baseUrl: "" },
          maxCallSeconds: 300,
          phoneConfig: { allowedCallees: [TARGET], maxCallDurationSeconds: 300 },
        });
      expect(build).toThrow(VoicePhoneTransportUnavailableError);
      try {
        build();
      } catch (error) {
        expect((error as Error).message).toBe(
          PHONE_TRANSPORT_UNAVAILABLE_MESSAGE,
        );
      }
    });
  });

  describe("given a Twilio environment and an allowlisted number", () => {
    /** @scenario "A phone target is dialled with an a-leg outbound call" */
    it("places an a-leg outbound call to the target on connect", async () => {
      const adapter = fakeAdapter();
      const runner = createPhoneTransport({
        env: TWILIO_ENV,
        twilioAgentFactory: factoryReturning(adapter),
      });
      const built = runner.createAgentAdapter({
        agentId: TARGET,
        credential: { apiKey: "", baseUrl: "" },
        maxCallSeconds: 300,
        phoneConfig: { allowedCallees: [TARGET], maxCallDurationSeconds: 300 },
      }) as unknown as TwilioAdapterLike;

      await built.connect();

      expect(adapter.connectCount).toBe(1);
      expect(adapter.placeCallArgs).toHaveLength(1);
      expect(adapter.placeCallArgs[0]).toMatchObject({
        to: TARGET,
        attachStream: "a-leg",
      });
    });
  });

  describe("given a Twilio environment but a number outside the allowlist", () => {
    /** @scenario "A phone target refuses a callee that is not allowlisted" */
    it("refuses before Twilio is reached (deny-by-default)", async () => {
      const adapter = fakeAdapter();
      const runner = createPhoneTransport({
        env: TWILIO_ENV,
        twilioAgentFactory: factoryReturning(adapter),
      });
      const built = runner.createAgentAdapter({
        agentId: TARGET,
        credential: { apiKey: "", baseUrl: "" },
        maxCallSeconds: 300,
        phoneConfig: { allowedCallees: [], maxCallDurationSeconds: 300 },
      }) as unknown as TwilioAdapterLike;

      await expect(built.connect()).rejects.toBeInstanceOf(
        VoicePhoneTransportUnavailableError,
      );
      expect(adapter.connectCount).toBe(0);
      expect(adapter.placeCallArgs).toHaveLength(0);
    });
  });

  describe("given a project cap above the ceiling", () => {
    /** @scenario "A phone call's duration is capped" */
    it("clamps the a-leg call duration to the ceiling", async () => {
      const adapter = fakeAdapter();
      const runner = createPhoneTransport({
        env: TWILIO_ENV,
        twilioAgentFactory: factoryReturning(adapter),
      });
      const built = runner.createAgentAdapter({
        agentId: TARGET,
        credential: { apiKey: "", baseUrl: "" },
        maxCallSeconds: 9000,
        phoneConfig: { allowedCallees: [TARGET], maxCallDurationSeconds: 9000 },
      }) as unknown as TwilioAdapterLike;

      await built.connect();

      expect(adapter.placeCallArgs[0]?.maxCallDurationSeconds).toBe(
        VOICE_PHONE_MAX_CALL_DURATION_SECONDS,
      );
    });
  });

  describe("given a phone call whose Twilio recording is still processing", () => {
    /** @scenario "A finished phone recording is not ready until Twilio completes it" */
    it("returns null so the live transcript is kept", async () => {
      const fetchImpl = vi.fn(async () =>
        new Response(JSON.stringify({ recordings: [{ status: "processing" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ) as unknown as typeof fetch;
      const runner = createPhoneTransport({ env: TWILIO_ENV, fetchImpl });

      const record = await runner.fetchCallRecord({
        conversationId: "CA123",
        credential: { apiKey: "", baseUrl: "" },
        audioProxyUrl: "/audio",
      });

      expect(record).toBeNull();
    });

    it("normalises a completed recording into a provider record with proxied audio", async () => {
      const fetchImpl = vi.fn(async () =>
        new Response(
          JSON.stringify({
            recordings: [
              { sid: "RE1", status: "completed", duration: "12", start_time: "2026-01-01T00:00:00Z" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ) as unknown as typeof fetch;
      const runner = createPhoneTransport({ env: TWILIO_ENV, fetchImpl });

      const record = await runner.fetchCallRecord({
        conversationId: "CA123",
        credential: { apiKey: "", baseUrl: "" },
        audioProxyUrl: "/audio",
      });

      expect(record).toMatchObject({
        transport: "phone",
        source: "provider",
        durationMs: 12_000,
        audioUrl: "/audio",
        turns: [],
      });
    });
  });

  describe("given a live call being ended at the whole-call limit", () => {
    it("disconnects the adapter to hang up", async () => {
      const adapter = fakeAdapter();
      const runner = createPhoneTransport({ env: TWILIO_ENV });
      await runner.endCall(adapter as unknown as Parameters<typeof runner.endCall>[0]);
      expect(adapter.disconnectCount).toBe(1);
    });
  });
});
