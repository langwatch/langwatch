/**
 * @vitest-environment node
 *
 * The Twilio model-provider registry entry: a non-LLM safety-class credential
 * container with three keys, only the auth token secret. Complements the
 * registry-walking credentialFieldClassification test with the twilio-specific
 * assertions the slice-2 brief calls for.
 *
 * @see specs/features/agents/voice-phone.feature
 */
import { describe, expect, it } from "vitest";
import { PUBLIC_CREDENTIAL_FIELDS } from "../../../utils/constants";
import {
	getSchemaShape,
	isSecretCredentialField,
} from "../../../utils/modelProviderHelpers";
import { modelProviders } from "../registry";

const twilio = modelProviders.twilio;

describe("twilio model provider", () => {
	describe("given the registry entry", () => {
		it("is a non-LLM safety-class credential container", () => {
			expect(twilio.type).toBe("safety");
			expect(twilio.apiKey).toBe("TWILIO_AUTH_TOKEN");
		});

		it("names exactly the account SID, auth token and from-number", () => {
			expect(Object.keys(getSchemaShape(twilio.keysSchema)).sort()).toEqual([
				"TWILIO_ACCOUNT_SID",
				"TWILIO_AUTH_TOKEN",
				"TWILIO_FROM_NUMBER",
			]);
		});
	});

	describe("when the keys schema validates a submission", () => {
		it("accepts an account SID, auth token and E.164 from-number", () => {
			const parsed = twilio.keysSchema.safeParse({
				TWILIO_ACCOUNT_SID: "AC123",
				TWILIO_AUTH_TOKEN: "tok-secret",
				TWILIO_FROM_NUMBER: "+14155550123",
			});
			expect(parsed.success).toBe(true);
		});

		it("rejects a from-number that is not E.164", () => {
			const parsed = twilio.keysSchema.safeParse({
				TWILIO_ACCOUNT_SID: "AC123",
				TWILIO_AUTH_TOKEN: "tok-secret",
				TWILIO_FROM_NUMBER: "415-555-0123",
			});
			expect(parsed.success).toBe(false);
		});

		it("requires the account SID", () => {
			const parsed = twilio.keysSchema.safeParse({
				TWILIO_ACCOUNT_SID: "",
				TWILIO_AUTH_TOKEN: "tok-secret",
				TWILIO_FROM_NUMBER: "+14155550123",
			});
			expect(parsed.success).toBe(false);
		});
	});

	describe("given credential classification", () => {
		it("treats only the auth token as secret", () => {
			expect(isSecretCredentialField("TWILIO_AUTH_TOKEN")).toBe(true);
			expect(isSecretCredentialField("TWILIO_ACCOUNT_SID")).toBe(false);
			expect(isSecretCredentialField("TWILIO_FROM_NUMBER")).toBe(false);
		});

		it("names the account SID and from-number as public, never the token", () => {
			expect(PUBLIC_CREDENTIAL_FIELDS.has("TWILIO_ACCOUNT_SID")).toBe(true);
			expect(PUBLIC_CREDENTIAL_FIELDS.has("TWILIO_FROM_NUMBER")).toBe(true);
			expect(PUBLIC_CREDENTIAL_FIELDS.has("TWILIO_AUTH_TOKEN")).toBe(false);
		});
	});
});
