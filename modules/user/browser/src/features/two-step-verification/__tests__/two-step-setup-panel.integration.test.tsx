/**
 * @vitest-environment jsdom
 *
 * The screen that sets two-step verification up.
 * @see specs/identity/mfa-and-session-shape.feature
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import { TwoStepSetupPanel } from "../ui/blocks/two-step-setup-panel.tsx";

const SETUP_URI = "otpauth://totp/LangWatch:sam@acme.com?secret=JBSWY3DPEHPK3PXP&issuer=LangWatch";

function renderPanel() {
  return renderWithPersonalWorkspaceHost(
    <TwoStepSetupPanel
      setupUri={SETUP_URI}
      isConfirming={false}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
    { host: fakePersonalWorkspaceHost() },
  );
}

afterEach(() => cleanup());

describe("<TwoStepSetupPanel />", () => {
  describe("given a setup that has been started", () => {
    describe("when the screen renders", () => {
      /** @scenario The setup screen shows the secret once and says so */
      it("offers a scannable code and the same value to type in", () => {
        renderPanel();

        expect(screen.getByTestId("two-factor-scannable-code").querySelector("svg")).toBeTruthy();
        const typed = screen.getByTestId("two-factor-shared-secret");
        expect(typed.querySelector("input")).toHaveProperty("value", "JBSWY3DPEHPK3PXP");
      });

      /** @scenario The setup screen shows the secret once and says so */
      it("says it will not be shown again once the setup finishes", () => {
        renderPanel();

        const notice = screen.getByTestId("two-factor-shown-once");
        expect(notice.textContent).toMatch(/shown once/i);
        expect(notice.textContent).toMatch(/will not be shown again/i);
        expect(
          notice.compareDocumentPosition(screen.getByTestId("confirm-two-factor")) &
            Node.DOCUMENT_POSITION_FOLLOWING,
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
