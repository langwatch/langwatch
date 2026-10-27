import { explainHandledError } from "@langwatch/handled-error/presentation";
import { describe, expect, it } from "vitest";

import {
  failedInBrowser,
  isCeremonyAbandoned,
  passkeyFailure,
  passkeyFailureFrom,
  readPasskeyErrorCode,
} from "../passkey-failure.ts";

describe("given a passkey ceremony that resolved with a refusal", () => {
  describe("when the server refused the credential", () => {
    /** @scenario A passkey nobody holds is refused without telling anyone anything */
    it("names the credential refusal for a 400", () => {
      expect(passkeyFailure(400)).toEqual({ error: "identity_passkey_not_recognized" });
    });

    it("names the credential refusal for a 401", () => {
      expect(passkeyFailure(401)).toEqual({ error: "identity_passkey_not_recognized" });
    });

    it("names the credential refusal for a 403", () => {
      expect(passkeyFailure(403)).toEqual({ error: "identity_passkey_not_recognized" });
    });
  });

  describe("when the ceremony never reached the server", () => {
    it("names the ceremony failure for no status", () => {
      expect(passkeyFailure(void 0)).toEqual({ error: "identity_passkey_ceremony_failed" });
    });

    it("names the ceremony failure for a server error", () => {
      expect(passkeyFailure(500)).toEqual({ error: "identity_passkey_ceremony_failed" });
    });
  });

  describe("when read from the client's own error shape", () => {
    it("reads the status straight through", () => {
      expect(passkeyFailureFrom({ status: 400 })).toEqual({
        error: "identity_passkey_not_recognized",
      });
    });

    it("treats a status of 0 the same as no status at all", () => {
      expect(passkeyFailureFrom({ status: 0 })).toEqual({
        error: "identity_passkey_ceremony_failed",
      });
    });

    it("never names a credential refusal for a failure in this browser", () => {
      expect(
        passkeyFailureFrom({ status: 400, code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" }),
      ).toEqual({ error: "identity_passkey_ceremony_failed" });
      expect(passkeyFailureFrom({ status: 400, code: "AUTH_CANCELLED" })).toEqual({
        error: "identity_passkey_ceremony_failed",
      });
    });

    it("treats a missing error as no status at all", () => {
      expect(passkeyFailureFrom(null)).toEqual({ error: "identity_passkey_ceremony_failed" });
    });
  });
});

describe("given a code off a resolved client error", () => {
  describe("when the error carries a code", () => {
    it("reads it", () => {
      expect(readPasskeyErrorCode({ code: "ERROR_CEREMONY_ABORTED" })).toBe(
        "ERROR_CEREMONY_ABORTED",
      );
    });
  });

  describe("when the error carries no code", () => {
    it("answers nothing rather than throwing", () => {
      expect(readPasskeyErrorCode({ status: 400 })).toBeUndefined();
    });
  });
});

describe("given a way to tell an abandoned ceremony from a refusal", () => {
  describe("when the resolved code names the abort", () => {
    it("reads it as abandoned", () => {
      expect(isCeremonyAbandoned({ code: "ERROR_CEREMONY_ABORTED" })).toBe(true);
    });
  });

  describe("when a thrown exception names the abort", () => {
    it("reads AbortError as abandoned", () => {
      expect(isCeremonyAbandoned({ name: "AbortError" })).toBe(true);
    });

    it("reads NotAllowedError as abandoned", () => {
      expect(isCeremonyAbandoned({ name: "NotAllowedError" })).toBe(true);
    });
  });

  describe("when neither the code nor the name says so", () => {
    it("does not read it as abandoned", () => {
      expect(isCeremonyAbandoned({ code: "SOME_OTHER_CODE" })).toBe(false);
    });

    it("does not read an empty input as abandoned", () => {
      expect(isCeremonyAbandoned({})).toBe(false);
    });
  });
});

describe("given every code a passkey ceremony can name", () => {
  const NAMED_CODES = [
    passkeyFailure(400).error,
    passkeyFailure(void 0).error,
    "identity_passkey_already_registered",
  ];

  /** @scenario Every named failure has copy a first-time reader understands */
  it.each(NAMED_CODES)(
    "%s has registered words that never show the code or an internal",
    (code) => {
      const explained = explainHandledError({
        code,
        meta: {},
        httpStatus: 400,
        fault: "customer",
        retryable: false,
        tips: [],
        docsUrl: undefined,
        traceId: undefined,
        reasons: [],
      });

      expect(explained.isRegistered).toBe(true);
      expect(explained.title.length).toBeGreaterThan(0);
      const spoken = `${explained.title} ${explained.description}`;
      expect(spoken).not.toContain(code);
      expect(spoken).not.toMatch(/credential id|credentialId|table|service|prisma|better-auth/i);
    },
  );
});

describe("given where a passkey ceremony failed", () => {
  it("places the client's own codes in this browser", () => {
    expect(failedInBrowser({ code: "AUTH_CANCELLED" })).toBe(true);
    expect(failedInBrowser({ code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" })).toBe(true);
  });

  it("places the server's refusals at the server", () => {
    expect(failedInBrowser({ code: "PASSKEY_NOT_FOUND" })).toBe(false);
    expect(failedInBrowser({ code: undefined })).toBe(false);
  });

  it("reads the passed-through NotAllowedError as a dismissal", () => {
    expect(isCeremonyAbandoned({ code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" })).toBe(true);
  });
});
