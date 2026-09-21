/** @vitest-environment node
 * Tests per-transport credential resolution: phone uses Twilio, ElevenLabs
 * uses its own (services mocked at seams).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findTwilioProviderForProject = vi.fn();
const getTwilioCredential = vi.fn();

const findElevenLabsProviderForProject = vi.fn();
const getElevenLabsApiCredential = vi.fn();

import { PHONE_NO_CREDENTIAL_MESSAGE } from "@langwatch/scenario-contract/voice-runtime";

import {
  resolveVoiceTarget,
  type VoiceTransportCredentialReader,
} from "../rules/voice-target.rules.ts";
import { createSerializedVoiceAgentAdapter } from "../voice-agent.adapter.ts";

beforeEach(() => vi.clearAllMocks());

const credentials: VoiceTransportCredentialReader = {
  findElevenLabs: async (projectId) => {
    const provider = await findElevenLabsProviderForProject({ projectId });
    return provider ? getElevenLabsApiCredential({ modelProviderId: provider.id }) : null;
  },
  findTwilio: async (projectId) => {
    const provider = await findTwilioProviderForProject({ projectId });
    return provider ? getTwilioCredential({ modelProviderId: provider.id }) : null;
  },
};

describe("resolveVoiceTarget", () => {
  describe("given a phone target", () => {
    describe("when the project has a Twilio provider", () => {
      it("carries the phone number and the twilio credential", async () => {
        findTwilioProviderForProject.mockResolvedValue({ id: "prov_twilio" });
        getTwilioCredential.mockResolvedValue({
          accountSid: "AC123",
          authToken: "tok-secret",
          fromNumber: "+14155550000",
        });
        const target = await resolveVoiceTarget({
          projectId: "p1",
          config: {
            transport: "phone",
            phoneNumber: "+14155559999",
            callDirection: "outbound",
          },
          credentials,
        });
        expect(target).toEqual({
          transport: "phone",
          agentId: "+14155559999",
          credential: {
            kind: "twilio",
            accountSid: "AC123",
            authToken: "tok-secret",
            fromNumber: "+14155550000",
          },
          callDirection: "outbound",
        });
      });
    });

    describe("when the project has no Twilio provider", () => {
      /** @scenario "A phone run fails clearly when the project has no Twilio provider" */
      it("carries a null credential so the run fails with a named message, and no call is placed", async () => {
        findTwilioProviderForProject.mockResolvedValue(null);
        const target = await resolveVoiceTarget({
          projectId: "p1",
          config: {
            transport: "phone",
            phoneNumber: "+14155559999",
            callDirection: "outbound",
          },
          credentials,
        });
        expect(target).toEqual({
          transport: "phone",
          agentId: "+14155559999",
          credential: null,
          callDirection: "outbound",
        });
        expect(getTwilioCredential).not.toHaveBeenCalled();

        const createAgentAdapter = vi.fn();
        expect(() =>
          createSerializedVoiceAgentAdapter({
            data: {
              type: "voice",
              agentId: "agent-row-1",
              voiceTarget: target,
              callerEnv: { OPENAI_API_KEY: "sk-openai" },
              maxCallSeconds: 90,
            },
            registry: {
              phone: {
                missingKeyMessage: PHONE_NO_CREDENTIAL_MESSAGE,
                createAgentAdapter,
                mintSession: vi.fn(),
                fetchCallRecord: vi.fn(),
                endCall: vi.fn(),
              },
              elevenlabs_convai: {
                missingKeyMessage: "unused",
                createAgentAdapter: vi.fn(),
                mintSession: vi.fn(),
                fetchCallRecord: vi.fn(),
                endCall: vi.fn(),
              },
            },
          }),
        ).toThrow(PHONE_NO_CREDENTIAL_MESSAGE);
        expect(PHONE_NO_CREDENTIAL_MESSAGE).toContain("Settings > Model Providers");
        expect(createAgentAdapter).not.toHaveBeenCalled();
      });
    });
  });

  describe("given an ElevenLabs target", () => {
    describe("when the project has an ElevenLabs provider", () => {
      it("carries the agent id and the elevenlabs credential", async () => {
        findElevenLabsProviderForProject.mockResolvedValue({ id: "prov_el" });
        getElevenLabsApiCredential.mockResolvedValue({
          apiKey: "xi-key",
          baseUrl: "https://api.elevenlabs.io",
        });
        const target = await resolveVoiceTarget({
          projectId: "p1",
          config: { transport: "elevenlabs_convai", agentId: "el_1" },
          credentials,
        });
        expect(target).toEqual({
          transport: "elevenlabs_convai",
          agentId: "el_1",
          credential: {
            kind: "elevenlabs",
            apiKey: "xi-key",
            baseUrl: "https://api.elevenlabs.io",
          },
        });
      });
    });
  });
});
