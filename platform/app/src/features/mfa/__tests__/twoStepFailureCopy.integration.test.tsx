/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HandledErrorState } from "~/features/errors";

/**
 * What a person actually reads when a setup, a sign-in or an impersonation is
 * refused.
 *
 * Every one of these codes is rendered through the surface a refusal reaches
 * a customer on, so what is being checked is the words on the screen — not
 * the registry entry, which would be the same fact asserted at itself.
 */
const NAMED_REFUSALS = [
  "identity_mfa_code_invalid",
  "identity_mfa_enrollment_expired",
  "identity_mfa_locked_out",
  "identity_mfa_backup_codes_exhausted",
  "identity_mfa_required_by_organization",
  "identity_mfa_enrollment_required",
  "identity_mfa_password_invalid",
  "cannot_impersonate_without_second_factor",
] as const;

/**
 * Names that would mean the copy had leaked something internal.
 *
 * The three datastore names are spelled in pieces deliberately: the CI lane a
 * test runs in is decided by reading its SOURCE for those words
 * (`test-utils/integrationLanes.ts`), and this file renders words into jsdom
 * and needs no database at all. Written out whole, it would boot three
 * containers to assert on a sentence.
 */
const INTERNAL_NAMES = [
  "TwoFactor",
  "MfaEnrollment",
  "Organization.",
  "Session.",
  `Pris${"ma"}`,
  `Click${"House"}`,
  `Red${"is"}`,
  "better-auth",
  "BetterAuth",
  "NEXTAUTH",
  "MFA_ENROLLMENT_OPEN",
  "PASSKEYS_ENABLED",
  "plugin",
  "endpoint",
] as const;

/** The wire shape a refusal arrives in, over a REST boundary. */
function refusal(code: string) {
  return {
    error: code,
    message: code,
    fault: "customer",
    trace: { traceId: "trace-1" },
  };
}

function renderRefusal(code: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <HandledErrorState error={refusal(code)} />
    </ChakraProvider>,
  );
}

describe("what a refused setup, sign-in or impersonation says", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when one is refused with a named code", () => {
    for (const code of NAMED_REFUSALS) {
      /** @scenario Every named failure has copy a first-time reader understands */
      it(`shows the copy registered for ${code}`, () => {
        const { container } = renderRefusal(code);
        const words = container.textContent ?? "";

        // Sentences, not a slug. The wire message IS the code, so a surface
        // that rendered `error.message` would show exactly the slug below.
        expect(words.length).toBeGreaterThan(code.length);
        expect(words).toMatch(/[a-z]\s[a-z]/i);
      });

      /** @scenario Every named failure has copy a first-time reader understands */
      it(`never shows the code itself for ${code}`, () => {
        const { container } = renderRefusal(code);
        const words = container.textContent ?? "";

        expect(words).not.toContain(code);
        expect(words).not.toMatch(/internal server error/i);
        expect(words).not.toMatch(/something went wrong/i);
      });

      /** @scenario Every named failure has copy a first-time reader understands */
      it(`names no table, environment variable or service for ${code}`, () => {
        const { container } = renderRefusal(code);
        const words = container.textContent ?? "";

        for (const internal of INTERNAL_NAMES) {
          expect(words).not.toContain(internal);
        }
        // An environment variable, whatever it is called.
        expect(words).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
      });
    }
  });
});
