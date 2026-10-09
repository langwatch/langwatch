/**
 * @vitest-environment jsdom
 * What a refused passkey reads as on screen: the alert the doors use, over every code a
 * passkey journey can refuse with, and over a failure nothing anticipated.
 * Spec: specs/identity/passkeys.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HandledErrorAlert } from "../handled-error-alert.tsx";

/** Every code a passkey journey on a door can refuse with; removal is the settings screen's. */
const PASSKEY_CODES = [
  "identity_passkey_not_recognized",
  "identity_passkey_ceremony_failed",
  "identity_passkey_already_registered",
] as const;

const renderRefusal = (code: string) =>
  renderWithDesignSystem(
    <HandledErrorAlert
      error={{ error: code, message: code, status: 400 }}
      fallbackTitle="Something went wrong"
    />,
  );

/** The line the registry falls back to when it has nothing better to say. */
const GENERIC = /we've been notified|something went wrong/i;

afterEach(() => cleanup());

describe("given a passkey refusal we named", () => {
  describe("when it reaches the card's alert", () => {
    for (const code of PASSKEY_CODES) {
      /** @scenario "Every named failure has copy a first-time reader understands" */
      it(`shows the registered words for ${code}, and never the code`, () => {
        const { container } = renderRefusal(code);

        const alert = screen.getByRole("alert");
        expect(alert.textContent?.length ?? 0).toBeGreaterThan(20);
        expect(container.textContent).not.toContain(code);
        // The generic line is reserved for the refusals nobody anticipated.
        expect(alert.textContent).not.toMatch(GENERIC);
      });

      /** @scenario "Every named failure has copy a first-time reader understands" */
      it(`names no credential, table or service for ${code}`, () => {
        const { container } = renderRefusal(code);
        const words = container.textContent ?? "";

        for (const internal of [
          "credentialID",
          "credentialId",
          "Passkey table",
          "webauthn",
          "WebAuthn",
          "Identifier",
          "better-auth",
          "rpId",
          "aaguid",
        ]) {
          expect(words).not.toContain(internal);
        }
      });
    }
  });
});

describe("given a passkey failure nothing anticipated", () => {
  describe("when it reaches the card's alert", () => {
    it("says it did not go through, and never shows what the client threw", () => {
      renderWithDesignSystem(
        <HandledErrorAlert
          error={new Error("something the client threw")}
          fallbackTitle="Could not use a passkey"
        />,
      );

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Could not use a passkey");
      expect(alert.textContent).not.toContain("something the client threw");
    });
  });
});
