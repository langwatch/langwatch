/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TwoFactorSetupPanel } from "../TwoFactorSetupPanel";

const SETUP_URI =
  "otpauth://totp/LangWatch:sam@acme.com?secret=JBSWY3DPEHPK3PXP&issuer=LangWatch";

function renderPanel() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TwoFactorSetupPanel
        setupUri={SETUP_URI}
        isConfirming={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    </ChakraProvider>,
  );
}

describe("<TwoFactorSetupPanel />", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given a setup that has been started", () => {
    describe("when the screen renders", () => {
      /** @scenario The setup screen shows the secret once and says so */
      it("offers a scannable code and the same value to type in", () => {
        renderPanel();

        // The square. Rendered from the setup link itself, so there is no way
        // for it to carry a different secret from the one written out below.
        expect(
          screen.getByTestId("two-factor-scannable-code"),
        ).toBeInTheDocument();

        // ...and the same value, in characters, for anybody who cannot scan.
        const typed = screen.getByTestId("two-factor-shared-secret");
        expect(typed.querySelector("input")).toHaveValue("JBSWY3DPEHPK3PXP");
      });

      /** @scenario The setup screen shows the secret once and says so */
      it("says it will not be shown again once the setup finishes", () => {
        renderPanel();

        const notice = screen.getByTestId("two-factor-shown-once");
        expect(notice.textContent).toMatch(/shown once/i);
        expect(notice.textContent).toMatch(/will not be shown again/i);
        // Before the button that ends the chance to read it, not after — a
        // warning underneath the action it is warning about is decoration.
        expect(
          notice.compareDocumentPosition(
            screen.getByTestId("confirm-two-factor"),
          ) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      });

      /** @scenario The setup screen shows the secret once and says so */
      it("names no table, service or plugin anywhere on it", () => {
        const { container } = renderPanel();
        const words = container.textContent ?? "";

        for (const internal of [
          "TwoFactor",
          "MfaEnrollment",
          "better-auth",
          "BetterAuth",
          "plugin",
          "table",
          "TOTP",
          "OTP",
          "2FA",
          "MFA",
        ]) {
          expect(words).not.toContain(internal);
        }
      });
    });
  });
});
