// @vitest-environment node
// Security: refused credentials explained in our words only, never upstream text
// (which may leak secrets like API keys)

import type { SerializedHandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import {
  describeFailure,
  describeRefusal,
  UNKNOWN_FAILURE_DESCRIPTION,
} from "../connection-verdict-copy.ts";

/** The sentence and the secret an upstream refusal can arrive carrying. */
const LEAKED_KEY = "sk-live-0123456789abcdef";
const UPSTREAM_SENTENCE = `API key not valid: ?key=${LEAKED_KEY}`;

function refusal({
  code,
  meta = {},
}: {
  code: string;
  meta?: Record<string, unknown>;
}): SerializedHandledError {
  return {
    code,
    kind: code,
    retryable: false,
    meta,
    httpStatus: 400,
    fault: "customer",
    reasons: [],
  };
}

describe("given a refusal from a provider", () => {
  describe("when the code is one the registry explains", () => {
    it("reads the registered title and remediation", () => {
      const message = describeRefusal(refusal({ code: "provider_key_invalid" }));

      expect(message).toContain("That API key was refused");
      expect(message).toContain("Check you copied the whole key");
    });

    it("never repeats the sentence the provider sent, nor anything in it", () => {
      const message = describeRefusal(
        refusal({
          code: "provider_key_invalid",
          meta: { message: UPSTREAM_SENTENCE, provider: "gemini" },
        }),
      );

      expect(message).not.toContain(LEAKED_KEY);
      expect(message).not.toContain(UPSTREAM_SENTENCE);
    });

    it("says the request could not be checked, not that the key is wrong, when nothing answered", () => {
      const message = describeRefusal(refusal({ code: "provider_unreachable" }));

      expect(message).toContain("Couldn't reach the provider");
      expect(message).toContain("was not checked");
      expect(message).not.toContain("refused");
    });

    it("explains a plan over its usage limit instead of a generic failure", () => {
      const message = describeRefusal(
        refusal({ code: "provider_usage_limit_reached", meta: { provider: "openai_codex" } }),
      );

      expect(message).toContain("That plan is over its usage limit");
      expect(message).not.toContain(UNKNOWN_FAILURE_DESCRIPTION);
    });

    it("tells an expired Codex session to sign in again, not to check a key", () => {
      const message = describeRefusal(
        refusal({ code: "codex_auth_failed", meta: { kind: "refresh_rejected" } }),
      );

      expect(message).toContain("Your OpenAI session expired");
      expect(message).toContain("Sign in to Codex again");
      expect(message).not.toContain("copied the whole key");
    });

    it("follows the Google door a restricted key was blocked on", () => {
      const agentPlatform = describeRefusal(
        refusal({
          code: "provider_key_restricted",
          meta: { reason: "API_KEY_SERVICE_BLOCKED", googleDoor: "agent-platform" },
        }),
      );
      const generativeLanguage = describeRefusal(
        refusal({
          code: "provider_key_restricted",
          meta: { reason: "API_KEY_SERVICE_BLOCKED", googleDoor: "gemini" },
        }),
      );

      expect(agentPlatform).toContain("clear the Google Cloud Project and Location fields");
      expect(generativeLanguage).toContain("fill in the Google Cloud Project and Location");
    });
  });

  describe("when the code is one the registry has never seen", () => {
    it("falls back to the generic line and renders nothing that arrived with it", () => {
      const message = describeRefusal(
        refusal({
          code: "some_code_we_have_never_seen",
          meta: { message: UPSTREAM_SENTENCE, hint: LEAKED_KEY },
        }),
      );

      expect(message).toContain(UNKNOWN_FAILURE_DESCRIPTION);
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
