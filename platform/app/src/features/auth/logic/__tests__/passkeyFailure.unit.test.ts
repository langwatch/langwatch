import { describe, expect, it } from "vitest";

import { isCeremonyAbandoned } from "../passkeyFailure";

/**
 * One rule for "nobody finished this", read by both ways into a ceremony: the
 * button on the rail and the offer that rides in the address field. They
 * disagreed, and the offer was the one that got it wrong — a sign-in that
 * WORKED tore its pending ceremony down on the way out, and the tear-down was
 * announced as a credential the server had turned down.
 *
 * Spec: specs/identity/passkeys.feature
 */
describe("given a passkey ceremony that ended", () => {
  describe("when the client resolved it as an abort", () => {
    /** @scenario Leaving the sign-in screen does not read as a passkey failure */
    it("reads as abandoned, whatever status rode along with it", () => {
      expect(isCeremonyAbandoned({ code: "ERROR_CEREMONY_ABORTED" })).toBe(
        true,
      );
    });
  });

  describe("when the browser threw instead", () => {
    /** @scenario Dismissing the passkey sheet is not a failure */
    it.each([
      ["AbortError"],
      ["NotAllowedError"],
    ])("reads %s as abandoned, because the platform reports a decline this way", (name) => {
      expect(isCeremonyAbandoned({ name })).toBe(true);
    });
  });

  describe("when the ceremony failed for a reason somebody has to act on", () => {
    /** @scenario A passkey I picked that cannot be used says so */
    it.each([
      ["ERROR_CREDENTIAL_NOT_FOUND"],
      // The client's word for "the throw was not a WebAuthn error at all",
      // which covers a failing authenticator as readily as a closed sheet.
      // Silencing it left a passkey that FAILED saying nothing at all.
      ["AUTH_CANCELLED"],
      ["ERROR_RELYING_PARTY_ID_INVALID"],
    ])("does not read %s as abandoned", (code) => {
      expect(isCeremonyAbandoned({ code })).toBe(false);
    });

    it("does not read an ordinary throw's name as abandoned", () => {
      expect(isCeremonyAbandoned({ name: "TypeError" })).toBe(false);
    });
  });

  describe("when nothing at all was carried back", () => {
    it("does not guess that it was abandoned", () => {
      expect(isCeremonyAbandoned({})).toBe(false);
    });
  });
});
