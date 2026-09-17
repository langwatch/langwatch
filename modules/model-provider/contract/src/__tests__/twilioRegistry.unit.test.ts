/**
 * @vitest-environment node
 * Guard Twilio registry entry: non-LLM safety-class credential container.
 * @see specs/features/agents/voice-phone.feature
 */
import { describe, expect, it } from "vitest";
import {
  getSchemaShape,
  isSecretCredentialField,
  PUBLIC_CREDENTIAL_FIELDS,
} from "../model-provider-credential.ts";
import { modelProviders } from "../model-provider-registry.ts";

describe("twilio model provider", () => {
  describe("given the registry entry", () => {
    it("keeps phone credentials out of the model-provider catalogue", () => {
      expect(modelProviders).not.toHaveProperty("twilio");
      expect(getSchemaShape(undefined)).toEqual({});
    });
  });

  describe("given credential classification", () => {
    it("treats only the auth token as secret", () => {
      expect(isSecretCredentialField("TWILIO_AUTH_TOKEN")).toBe(true);
      expect(isSecretCredentialField("TWILIO_ACCOUNT_SID")).toBe(true);
      expect(isSecretCredentialField("TWILIO_FROM_NUMBER")).toBe(true);
    });

    it("names the account SID and from-number as public, never the token", () => {
      expect(PUBLIC_CREDENTIAL_FIELDS.has("TWILIO_ACCOUNT_SID")).toBe(false);
      expect(PUBLIC_CREDENTIAL_FIELDS.has("TWILIO_FROM_NUMBER")).toBe(false);
      expect(PUBLIC_CREDENTIAL_FIELDS.has("TWILIO_AUTH_TOKEN")).toBe(false);
    });
  });
});
