/**
 * @vitest-environment node
 *
 * The prefetcher's per-transport credential resolution. Phone resolves the
 * project's Twilio provider; ElevenLabs resolves its own. Either is `null` when
 * the project has no provider row, which the child surfaces as the transport's
 * named missing-key failure. The two credential services are mocked at their
 * seams so this exercises only the branch selection and the credential shaping.
 *
 * @see specs/features/agents/voice-phone.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/env.mjs", () => ({
	env: {
		LANGWATCH_NLP_SERVICE: "http://nlp:5561",
		LANGWATCH_ENDPOINT: "http://app:5560",
	},
}));

const findTwilioProviderForProject = vi.fn();
const getTwilioCredential = vi.fn();
vi.mock("~/server/gateway/twilioCredential.service", () => ({
	findTwilioProviderForProject: (...a: unknown[]) =>
		findTwilioProviderForProject(...a),
	getTwilioCredential: (...a: unknown[]) => getTwilioCredential(...a),
}));

const findElevenLabsProviderForProject = vi.fn();
const getElevenLabsApiCredential = vi.fn();
vi.mock("~/server/gateway/elevenLabsCredential.service", () => ({
	findElevenLabsProviderForProject: (...a: unknown[]) =>
		findElevenLabsProviderForProject(...a),
	getElevenLabsApiCredential: (...a: unknown[]) =>
		getElevenLabsApiCredential(...a),
}));

import { resolveVoiceTarget } from "../data-prefetcher";

beforeEach(() => vi.clearAllMocks());

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
					config: { transport: "phone", phoneNumber: "+14155559999" },
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
				});
			});
		});

		describe("when the project has no Twilio provider", () => {
			it("carries a null credential so the run fails with a named message", async () => {
				findTwilioProviderForProject.mockResolvedValue(null);
				const target = await resolveVoiceTarget({
					projectId: "p1",
					config: { transport: "phone", phoneNumber: "+14155559999" },
				});
				expect(target).toEqual({
					transport: "phone",
					agentId: "+14155559999",
					credential: null,
				});
				expect(getTwilioCredential).not.toHaveBeenCalled();
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
