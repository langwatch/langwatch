/**
 * @see specs/features/agents/voice-phone.feature
 */

import { describe, expect, it } from "vitest";

import {
  PHONE_TRANSPORT_UNAVAILABLE_MESSAGE,
  phoneTransport,
  VoicePhoneTransportUnavailableError,
} from "../transports/phone.transport";
import type {
  VoiceTransportCredential,
  VoiceTransportRunner,
} from "../voice-transport.registry";

const credential: VoiceTransportCredential = {
  apiKey: "k",
  baseUrl: "https://x",
};

describe("phoneTransport (stub runner)", () => {
  describe("given the voice worker that dials phone targets does not exist yet", () => {
    describe("when any runner method is called", () => {
      /** @scenario "Running a phone target before the voice worker exists fails with a clear message" */
      it("throws the unavailable error with the tracking message from every method", () => {
        const expectThrows = (call: () => unknown) => {
          expect(call).toThrow(VoicePhoneTransportUnavailableError);
          try {
            call();
          } catch (error) {
            expect((error as VoicePhoneTransportUnavailableError).code).toBe(
              "voice_phone_transport_unavailable",
            );
            expect((error as Error).message).toBe(
              PHONE_TRANSPORT_UNAVAILABLE_MESSAGE,
            );
          }
        };

        const runner: VoiceTransportRunner = phoneTransport;
        expectThrows(() =>
          runner.createAgentAdapter({
            agentId: "a",
            credential,
            maxCallSeconds: 60,
          }),
        );
        expectThrows(() =>
          runner.fetchCallRecord({
            conversationId: "c",
            credential,
            audioProxyUrl: "/audio",
          }),
        );
        expectThrows(() =>
          runner.endCall({} as Parameters<VoiceTransportRunner["endCall"]>[0]),
        );
      });
    });

    describe("when a browser session mint is attempted", () => {
      /** @scenario "A phone target has no browser call" */
      it("throws rather than minting, because phone has no browser call", () => {
        const mint = () =>
          phoneTransport.mintSession({ agentId: "a", credential });
        expect(mint).toThrow(VoicePhoneTransportUnavailableError);
        try {
          mint();
        } catch (error) {
          expect((error as VoicePhoneTransportUnavailableError).code).toBe(
            "voice_phone_transport_unavailable",
          );
          expect((error as Error).message).toBe(
            PHONE_TRANSPORT_UNAVAILABLE_MESSAGE,
          );
        }
      });
    });
  });
});
