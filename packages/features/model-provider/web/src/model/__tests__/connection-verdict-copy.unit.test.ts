/**
 * @vitest-environment node
 *
 * A refused credential is explained in OUR words, resolved from the refusal's
 * stable code, and never in the provider's.
 *
 * The reason this is a test rather than a reading of the table: a
 * rejected-credential body is exactly where a credential turns up — Gemini
 * quotes the request back, key included — so "we render nothing that arrived
 * with the refusal" is a security property, not a style preference. The refusal
 * payload below carries a `message` field holding an upstream sentence with a
 * key in it; nothing this module returns may contain any of it.
 *
 * Spec: specs/model-providers/credential-validation.feature
 */

import { describe, expect, it } from "vitest";
import {
  describeFailure,
  describeRefusal,
  REGISTERED_REFUSAL_CODES,
  UNKNOWN_FAILURE_DESCRIPTION,
} from "../connection-verdict-copy";

/** The sentence and the secret an upstream refusal can arrive carrying. */
const LEAKED_KEY = "sk-live-0123456789abcdef";
const UPSTREAM_SENTENCE = `API key not valid: ?key=${LEAKED_KEY}`;

describe("given a refusal from a provider", () => {
  describe("when the code is one this surface raises", () => {
    it("reads the registered title and remediation", () => {
      const message = describeRefusal({ code: "provider_key_invalid", meta: {} });

      expect(message).toContain("That API key was refused");
      expect(message).toContain("Check you copied the whole key");
    });

    it("never repeats the sentence the provider sent, nor anything in it", () => {
      const message = describeRefusal({
        code: "provider_key_invalid",
        meta: { message: UPSTREAM_SENTENCE, provider: "gemini" },
      });

      expect(message).not.toContain(LEAKED_KEY);
      expect(message).not.toContain(UPSTREAM_SENTENCE);
    });

    it("never renders the code itself, which is what the wire message becomes", () => {
      for (const code of REGISTERED_REFUSAL_CODES) {
        expect(describeRefusal({ code, meta: {} })).not.toContain(code);
      }
    });

    it("says the request could not be checked, not that the key is wrong, when nothing answered", () => {
      const message = describeRefusal({ code: "provider_unreachable", meta: {} });

      expect(message).toContain("Couldn't reach the provider");
      expect(message).toContain("was not checked");
      expect(message).not.toContain("refused");
    });

    it("follows the Google door a restricted key was blocked on", () => {
      const agentPlatform = describeRefusal({
        code: "provider_key_restricted",
        meta: { reason: "API_KEY_SERVICE_BLOCKED", googleDoor: "agent-platform" },
      });
      const generativeLanguage = describeRefusal({
        code: "provider_key_restricted",
        meta: { reason: "API_KEY_SERVICE_BLOCKED", googleDoor: "gemini" },
      });

      expect(agentPlatform).toContain("clear the Google Cloud Project and Location fields");
      expect(generativeLanguage).toContain("fill in the Google Cloud Project and Location");
    });
  });

  describe("when the code is one this surface has no copy for", () => {
    it("says the credential was refused and falls back to the generic line", () => {
      const message = describeRefusal({
        code: "some_code_we_have_never_seen",
        meta: { message: UPSTREAM_SENTENCE },
      });

      expect(message).toContain("The credential was refused");
      expect(message).toContain(UNKNOWN_FAILURE_DESCRIPTION);
    });

    it("still renders nothing that arrived with the refusal", () => {
      const message = describeRefusal({
        code: "some_code_we_have_never_seen",
        meta: { message: UPSTREAM_SENTENCE, hint: LEAKED_KEY },
      });

      expect(message).not.toContain(LEAKED_KEY);
      expect(message).not.toContain("some_code_we_have_never_seen");
    });
  });
});

describe("given the probe itself never ran", () => {
  it("names the action that failed rather than judging the credential", () => {
    const message = describeFailure({ fallbackTitle: "Couldn't test this connection" });

    expect(message).toContain("Couldn't test this connection");
    expect(message).not.toContain("refused");
  });
});
