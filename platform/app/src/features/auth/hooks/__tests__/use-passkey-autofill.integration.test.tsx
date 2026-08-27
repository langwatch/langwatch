/**
 * @vitest-environment jsdom
 *
 * The passkey autofill offer: a conditional-mediation request is supposed to
 * be invisible, but a third-party passkey provider (1Password) answers it
 * with its own unlock sheet the moment it starts. These tests pin the fix:
 * the request starts on the person's first real gesture toward the address
 * field — a click or a keystroke — never on page load, and never on the
 * programmatic focus the entrance gives the field itself.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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

function Door({
  enabled,
  onError,
}: {
  enabled: boolean;
  onError?: (error: unknown) => void;
}) {
  usePasskeyAutofill({ enabled, onError });
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

    /** @scenario The passkey offer waits until I reach for the address field */
    it("stays silent when the page focuses the field itself", async () => {
      // The entrance autofocuses the address field (useFocusWhenSettled).
      // The page's own focus is the page's intent, not the person's — it
      // must not ring anybody's passkey provider.
      const { getByLabelText } = render(<Door enabled />);

      getByLabelText("Email").focus();
      await flush();

      expect(passkeyMock).not.toHaveBeenCalled();
    });
  });

  describe("when I click into the address field", () => {
    /** @scenario The passkey offer waits until I reach for the address field */
    it("starts the offer once, and never again for this visit", async () => {
      const { getByLabelText } = render(<Door enabled />);
      const email = getByLabelText("Email");

      fireEvent.pointerDown(email);
      await waitFor(() =>
        expect(passkeyMock).toHaveBeenCalledWith({ autoFill: true }),
      );

      fireEvent.pointerDown(email);
      fireEvent.keyDown(email, { key: "a" });
      await flush();
      expect(passkeyMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when I start typing in the field the page focused for me", () => {
    /** @scenario The passkey offer waits until I reach for the address field */
    it("starts the offer on the first keystroke", async () => {
      const { getByLabelText } = render(<Door enabled />);
      const email = getByLabelText("Email");
      email.focus();
      await flush();
      expect(passkeyMock).not.toHaveBeenCalled();

      fireEvent.keyDown(email, { key: "a" });

      await waitFor(() =>
        expect(passkeyMock).toHaveBeenCalledWith({ autoFill: true }),
      );
    });
  });

  describe("when I tab my way into the address field", () => {
    /** @scenario The passkey offer waits until I reach for the address field */
    it("starts the offer as focus lands", async () => {
      const { getByLabelText } = render(<Door enabled />);
      const name = getByLabelText("Name");
      name.focus();

      // The Tab keystroke is the gesture; the focus arriving is the landing.
      fireEvent.keyDown(name, { key: "Tab" });
      getByLabelText("Email").focus();

      await waitFor(() =>
        expect(passkeyMock).toHaveBeenCalledWith({ autoFill: true }),
      );
    });
  });

  describe("when my gestures land anywhere else", () => {
    /** @scenario The passkey offer waits until I reach for the address field */
    it("starts nothing", async () => {
      const { getByLabelText } = render(<Door enabled />);

      fireEvent.pointerDown(getByLabelText("Name"));
      fireEvent.keyDown(getByLabelText("Name"), { key: "a" });
      await flush();

      expect(passkeyMock).not.toHaveBeenCalled();
    });
  });

  describe("when this deployment offers no passkeys", () => {
    it("starts nothing, gestures or not", async () => {
      const { getByLabelText } = render(<Door enabled={false} />);

      fireEvent.pointerDown(getByLabelText("Email"));
      await flush();

      expect(passkeyMock).not.toHaveBeenCalled();
    });
  });

  describe("when the browser cannot do conditional mediation", () => {
    it("leaves the visitor alone even after a gesture", async () => {
      vi.stubGlobal("PublicKeyCredential", undefined);
      const { getByLabelText } = render(<Door enabled />);

      fireEvent.pointerDown(getByLabelText("Email"));
      await flush();

      expect(passkeyMock).not.toHaveBeenCalled();
    });
  });

  /**
   * Picking a passkey is starting something, and the silence that is right
   * for a pending offer is wrong the moment somebody chooses a credential.
   * Reported from a live stack: a passkey the server no longer held was
   * refused correctly (`identity_passkey_not_recognized`) and the screen said
   * nothing at all, so the click read as broken.
   */
  describe("when somebody picks a passkey the server refuses", () => {
    /** @scenario A passkey I picked that cannot be used says so */
    it("tells the screen, so the refusal is not silent", async () => {
      const refusal = { code: "identity_passkey_not_recognized" };
      passkeyMock.mockImplementationOnce(
        async () => ({ error: refusal }) as never,
      );
      const onError = vi.fn();
      const { getByLabelText } = render(<Door enabled onError={onError} />);

      fireEvent.pointerDown(getByLabelText("Email"));

      await waitFor(() => expect(onError).toHaveBeenCalledWith(refusal));
      expect(navigateMock).not.toHaveBeenCalled();
    });

    /** @scenario A passkey I picked that cannot be used says so */
    it("reports a ceremony that threw rather than answered", async () => {
      const thrown = new Error("the authenticator gave up");
      passkeyMock.mockImplementationOnce(async () => {
        throw thrown;
      });
      const onError = vi.fn();
      const { getByLabelText } = render(<Door enabled onError={onError} />);

      fireEvent.pointerDown(getByLabelText("Email"));

      await waitFor(() => expect(onError).toHaveBeenCalledWith(thrown));
    });
  });

  describe("when somebody dismisses the sheet instead", () => {
    /** @scenario Dismissing the passkey sheet is not a failure */
    it.each([["NotAllowedError"], ["AbortError"]])(
      "stays silent for %s, because nobody finished anything",
      async (name) => {
        passkeyMock.mockImplementationOnce(async () => {
          throw new DOMException("declined", name);
        });
        const onError = vi.fn();
        const { getByLabelText } = render(<Door enabled onError={onError} />);

        fireEvent.pointerDown(getByLabelText("Email"));
        await flush();

        expect(onError).not.toHaveBeenCalled();
      },
    );
  });
});
