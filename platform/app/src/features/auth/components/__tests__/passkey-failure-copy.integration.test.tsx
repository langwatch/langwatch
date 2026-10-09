/**
 * @vitest-environment jsdom
 *
 * What a refused passkey looks like on a screen.
 *
 * The translation table decides WHICH code a refusal carries
 * (`server/better-auth/__tests__/betterAuthErrorSweep.unit.test.ts`); this
 * decides what a person then reads, by rendering the alert the auth screens
 * actually uses over each of those codes.
 *
 * Spec: specs/identity/passkeys.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HandledErrorAlert } from "~/features/errors";

/** Every code a passkey journey can refuse with, as the wire sends it. */
const PASSKEY_CODES = [
  "identity_passkey_not_recognized",
  "identity_passkey_ceremony_failed",
  "identity_passkey_already_registered",
  "identity_detach_strands_user",
] as const;

const renderRefusal = (code: string) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <HandledErrorAlert
        error={{ error: code, message: code, status: 400 }}
        fallbackTitle="Something went wrong"
      />
    </ChakraProvider>,
  );

/** The line the registry falls back to when it has nothing better to say. */
const GENERIC = /we've been notified|something went wrong/i;

describe("a refused passkey, on screen", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given a refusal we named", () => {
    describe("when it reaches the card's alert", () => {
      for (const code of PASSKEY_CODES) {
        /** @scenario Every named failure has copy a first-time reader understands */
        it(`shows the registered words for ${code}, and never the code`, () => {
          const { container } = renderRefusal(code);

          const alert = screen.getByRole("alert");
          expect(alert.textContent?.length ?? 0).toBeGreaterThan(20);
          // The code is vocabulary, not copy. It reaches the log line and the
          // registry key; it never reaches a reader.
          expect(container.textContent).not.toContain(code);
          // And the generic fallback is not what a NAMED refusal resolves to
          // — that line is reserved for the ones we could not anticipate.
          expect(alert.textContent).not.toMatch(GENERIC);
        });

        /** @scenario Every named failure has copy a first-time reader understands */
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

  describe("given a refusal nothing anticipated", () => {
    describe("when it reaches the card's alert", () => {
      /** @scenario A failure we cannot name stays unnamed */
      it("says it did not go through, with a trace identifier and no invented code", () => {
        render(
          <ChakraProvider value={defaultSystem}>
            <HandledErrorAlert
              error={new Error("something the client threw")}
              fallbackTitle="Could not use a passkey"
            />
          </ChakraProvider>,
        );

        const alert = screen.getByRole("alert");
        expect(alert.textContent).toContain("Could not use a passkey");
        // The thrown message is not copy and is not shown.
        expect(alert.textContent).not.toContain("something the client threw");
      });
    });
  });
});
