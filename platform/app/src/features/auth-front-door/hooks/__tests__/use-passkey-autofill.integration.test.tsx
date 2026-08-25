/**
 * @vitest-environment jsdom
 *
 * The passkey autofill offer: a conditional-mediation request is supposed to
 * be invisible, but a third-party passkey provider (1Password) answers it
 * with its own unlock sheet the moment it starts. These tests pin the fix:
 * the request starts on the address field's first focus, never on page load.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { passkeyMock, navigateMock } = vi.hoisted(() => ({
  passkeyMock: vi.fn(() => new Promise(() => undefined)),
  navigateMock: vi.fn(),
}));

vi.mock("~/utils/auth-client", () => ({
  authClient: { signIn: { passkey: passkeyMock } },
  navigate: navigateMock,
  safeRedirectTarget: (url?: string) => url ?? "/",
}));

import { usePasskeyAutofill } from "../usePasskeyAutofill";

function Door({ enabled }: { enabled: boolean }) {
  usePasskeyAutofill({ enabled });
  return (
    <div>
      <input aria-label="Email" autoComplete="username webauthn" />
      <input aria-label="Name" autoComplete="name" />
    </div>
  );
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("given a deployment that offers passkeys", () => {
  beforeEach(() => {
    vi.stubGlobal("PublicKeyCredential", {
      isConditionalMediationAvailable: vi.fn(async () => true),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    passkeyMock.mockClear();
  });

  describe("when the sign-in screen opens", () => {
    /** @scenario The passkey offer waits until I reach for the address field */
    it("starts no passkey request", async () => {
      render(<Door enabled />);
      await flush();

      expect(passkeyMock).not.toHaveBeenCalled();
    });
  });

  describe("when I focus the address field", () => {
    /** @scenario The passkey offer waits until I reach for the address field */
    it("starts the offer once, and never again for this visit", async () => {
      const { getByLabelText } = render(<Door enabled />);

      getByLabelText("Email").focus();
      await waitFor(() =>
        expect(passkeyMock).toHaveBeenCalledWith({ autoFill: true }),
      );

      getByLabelText("Email").blur();
      getByLabelText("Email").focus();
      await flush();
      expect(passkeyMock).toHaveBeenCalledTimes(1);
    });

    /** @scenario The passkey offer waits until I reach for the address field */
    it("ignores focus landing on any other field", async () => {
      const { getByLabelText } = render(<Door enabled />);

      getByLabelText("Name").focus();
      await flush();

      expect(passkeyMock).not.toHaveBeenCalled();
    });
  });

  describe("when I am already in the field as the offer becomes available", () => {
    /** @scenario The passkey offer waits until I reach for the address field */
    it("starts the offer immediately", async () => {
      const { getByLabelText, rerender } = render(<Door enabled={false} />);
      getByLabelText("Email").focus();
      await flush();
      expect(passkeyMock).not.toHaveBeenCalled();

      rerender(<Door enabled />);

      await waitFor(() =>
        expect(passkeyMock).toHaveBeenCalledWith({ autoFill: true }),
      );
    });
  });

  describe("when this deployment offers no passkeys", () => {
    it("starts nothing, focus or not", async () => {
      const { getByLabelText } = render(<Door enabled={false} />);

      getByLabelText("Email").focus();
      await flush();

      expect(passkeyMock).not.toHaveBeenCalled();
    });
  });

  describe("when the browser cannot do conditional mediation", () => {
    it("leaves the visitor alone even after focus", async () => {
      vi.stubGlobal("PublicKeyCredential", undefined);
      const { getByLabelText } = render(<Door enabled />);

      getByLabelText("Email").focus();
      await flush();

      expect(passkeyMock).not.toHaveBeenCalled();
    });
  });
});
