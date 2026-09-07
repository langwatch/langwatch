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
 * Spec: specs/identity/passkeys.feature
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

import { UNKNOWN_ERROR_PRESENTATION } from "~/features/errors/logic/presentation";
import { resolveErrorCopy } from "~/features/errors/logic/resolveErrorCopy";

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
    /**
     * Asserted through `resolveErrorCopy`, which is the one implementation of
     * "what does this error say to a customer" — the same call the card's
     * alert makes. Asserting that `onError` received the plugin's own object
     * was the bug wearing a test: the raw `{ code, status }` is not a shape
     * `readHandledError` can read, so a refusal the server had named
     * correctly reached the screen as the generic "We've been notified", and
     * a test that checked only the object's identity could never see it. The
     * scenario says the refusal SAYS SO, so that is what is asserted.
     */
    /** @scenario A passkey I picked that cannot be used says so */
    it("says which passkey problem it was, in words", async () => {
      passkeyMock.mockImplementationOnce(
        async () =>
          ({
            error: { code: "ERROR_CREDENTIAL_NOT_FOUND", status: 401 },
          }) as never,
      );
      const onError = vi.fn();
      const { getByLabelText } = render(<Door enabled onError={onError} />);

      fireEvent.pointerDown(getByLabelText("Email"));

      await waitFor(() => expect(onError).toHaveBeenCalled());
      const copy = resolveErrorCopy({
        error: onError.mock.calls[0]?.[0],
        fallbackTitle: "Could not use a passkey",
      });
      expect(copy.title).toBe("That passkey isn't one we recognize");
      expect(copy.description).not.toBe(UNKNOWN_ERROR_PRESENTATION.description);
      expect(navigateMock).not.toHaveBeenCalled();
    });

    /** @scenario A passkey I picked that cannot be used says so */
    it("says a ceremony that threw did not finish, rather than apologising", async () => {
      passkeyMock.mockImplementationOnce(async () => {
        throw new Error("the authenticator gave up");
      });
      const onError = vi.fn();
      const { getByLabelText } = render(<Door enabled onError={onError} />);

      fireEvent.pointerDown(getByLabelText("Email"));

      await waitFor(() => expect(onError).toHaveBeenCalled());
      const copy = resolveErrorCopy({
        error: onError.mock.calls[0]?.[0],
        fallbackTitle: "Could not use a passkey",
      });
      expect(copy.title).toBe("That passkey attempt didn't finish");
      expect(copy.description).not.toBe(UNKNOWN_ERROR_PRESENTATION.description);
    });
  });

  /**
   * The offer has no abort handle, so a screen on its way out cannot cancel
   * the ceremony it started — and going away is what a sign-in that WORKED
   * does. The client reports the tear-down as a refusal carrying a 400, which
   * is the status that means the server turned the credential down, so a
   * password sign-in ended by flashing "That passkey isn't one we recognize"
   * across the moment before the next page arrived.
   */
  describe("when the screen goes away with an offer still pending", () => {
    /** @scenario Leaving the sign-in screen does not read as a passkey failure */
    it("says nothing about a ceremony the navigation abandoned", async () => {
      passkeyMock.mockImplementationOnce(
        async () =>
          ({
            error: {
              code: "ERROR_CEREMONY_ABORTED",
              status: 400,
              statusText: "BAD_REQUEST",
            },
          }) as never,
      );
      const onError = vi.fn();
      const { getByLabelText } = render(<Door enabled onError={onError} />);

      fireEvent.pointerDown(getByLabelText("Email"));
      await flush();

      expect(onError).not.toHaveBeenCalled();
      expect(navigateMock).not.toHaveBeenCalled();
    });

    /**
     * Unmounting is too late to learn the page is leaving: the navigation
     * tears the ceremony down while this screen is still on it, so the
     * refusal would land on a card nobody is going to look at again.
     */
    /** @scenario Leaving the sign-in screen does not read as a passkey failure */
    it("ignores whatever the ceremony settles to once the page is leaving", async () => {
      let settle: ((result: unknown) => void) | undefined;
      passkeyMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settle = resolve;
          }),
      );
      const onError = vi.fn();
      const { getByLabelText } = render(<Door enabled onError={onError} />);

      fireEvent.pointerDown(getByLabelText("Email"));
      await waitFor(() => expect(passkeyMock).toHaveBeenCalled());

      window.dispatchEvent(new Event("pagehide"));
      settle?.({ error: { code: "ERROR_CREDENTIAL_NOT_FOUND", status: 401 } });
      await flush();

      expect(onError).not.toHaveBeenCalled();
      expect(navigateMock).not.toHaveBeenCalled();
    });

    /**
     * The guard is the CODE, never the status. A 400 is what the client gives
     * an abandoned ceremony and also what the server gives a credential it
     * will not take — silencing by status would silence a real refusal, which
     * is the bug this whole file exists to keep fixed.
     */
    /** @scenario A passkey I picked that cannot be used says so */
    it("still says so when a refusal shares the abandoned ceremony's status", async () => {
      passkeyMock.mockImplementationOnce(
        async () =>
          ({
            error: { code: "ERROR_CREDENTIAL_NOT_FOUND", status: 400 },
          }) as never,
      );
      const onError = vi.fn();
      const { getByLabelText } = render(<Door enabled onError={onError} />);

      fireEvent.pointerDown(getByLabelText("Email"));

      await waitFor(() => expect(onError).toHaveBeenCalled());
      const copy = resolveErrorCopy({
        error: onError.mock.calls[0]?.[0],
        fallbackTitle: "Could not use a passkey",
      });
      expect(copy.title).toBe("That passkey isn't one we recognize");
    });
  });

  describe("when somebody dismisses the sheet instead", () => {
    /** @scenario Dismissing the passkey sheet is not a failure */
    it.each([
      ["NotAllowedError"],
      ["AbortError"],
    ])("stays silent for %s, because nobody finished anything", async (name) => {
      passkeyMock.mockImplementationOnce(async () => {
        throw new DOMException("declined", name);
      });
      const onError = vi.fn();
      const { getByLabelText } = render(<Door enabled onError={onError} />);

      fireEvent.pointerDown(getByLabelText("Email"));
      await flush();

      expect(onError).not.toHaveBeenCalled();
    });
  });
});
