/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackupCodesPanel } from "../BackupCodesPanel";

const CODES = ["11111111", "22222222", "33333333"];

function renderPanel() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <BackupCodesPanel codes={CODES} onDone={vi.fn()} />
    </ChakraProvider>,
  );
}

describe("<BackupCodesPanel />", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given a fresh set of codes", () => {
    describe("when they are shown", () => {
      /** @scenario The backup codes screen says what they are for in plain words */
      it("explains they are for signing in when the authenticator is not available", () => {
        const { container } = renderPanel();
        const words = container.textContent ?? "";

        expect(words).toMatch(/sign in/i);
        expect(words).toMatch(/not available/i);
      });

      /** @scenario The backup codes screen says what they are for in plain words */
      it("says each one works once and is shown this once only", () => {
        const { container } = renderPanel();
        const words = container.textContent ?? "";

        expect(words).toMatch(/each code works once/i);
        expect(words).toMatch(/only time they are shown/i);
        expect(screen.getAllByTestId("two-factor-backup-code")).toHaveLength(
          CODES.length,
        );
      });

      /** @scenario The backup codes screen says what they are for in plain words */
      it("writes every word out rather than shortening it", () => {
        const { container } = renderPanel();
        const words = container.textContent ?? "";

        // Each of these is a shortening a reader has to expand for
        // themselves, and at this screen a wrong guess costs them their way
        // back into the account.
        for (const shortening of [
          "2FA",
          "MFA",
          "OTP",
          "TOTP",
          "auth app",
          "authr",
          "recov codes",
          "single-use",
        ]) {
          expect(words).not.toContain(shortening);
        }
      });
    });
  });
});
