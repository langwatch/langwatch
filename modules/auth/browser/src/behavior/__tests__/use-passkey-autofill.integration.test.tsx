/**
 * @vitest-environment jsdom
 * Passkey autofill request starts on first gesture to address field, not page load
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { passkeyMock, navigateMock } = vi.hoisted(() => ({
  passkeyMock: vi.fn(() => new Promise(() => undefined)),
  navigateMock: vi.fn(),
}));

vi.mock("../auth-client.tsx", () => ({
  authClient: { signIn: { passkey: passkeyMock } },
  navigate: navigateMock,
  safeRedirectTarget: (url?: string) => url ?? "/",
}));

import { usePasskeyAutofill } from "../use-passkey-autofill.ts";

function Door({ enabled, onError }: { enabled: boolean; onError?: (error: unknown) => void }) {
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
      await waitFor(() => expect(passkeyMock).toHaveBeenCalledWith({ autoFill: true }));

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

      await waitFor(() => expect(passkeyMock).toHaveBeenCalledWith({ autoFill: true }));
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

      await waitFor(() => expect(passkeyMock).toHaveBeenCalledWith({ autoFill: true }));
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

  // The plugin does not throw an abandoned ceremony — it RESOLVES it,
  // carrying a 400, straight into the branch that reads a 400 as "the server
  // looked at this credential and said no". These two pin that only a
  // ceremony that genuinely resolved with a refusal is reported.
  describe("when I pick a passkey from the address field's own offer", () => {
    describe("and it cannot be used", () => {
      /** @scenario "A passkey I picked that cannot be used says so" */
      it("reports the refusal through the shared registry mapping", async () => {
        passkeyMock.mockResolvedValueOnce({
          data: null,
          error: { code: "PASSKEY_NOT_FOUND", status: 400, statusText: "BAD_REQUEST" },
        });
        const onError = vi.fn();
        const { getByLabelText } = render(<Door enabled onError={onError} />);

        fireEvent.pointerDown(getByLabelText("Email"));

        await waitFor(() =>
          expect(onError).toHaveBeenCalledWith({ error: "identity_passkey_not_recognized" }),
        );
      });
    });

    describe("and the ceremony was abandoned rather than refused", () => {
      /** @scenario "Dismissing the passkey sheet is not a failure" */
      it("says nothing about it", async () => {
        passkeyMock.mockResolvedValueOnce({
          data: null,
          error: { code: "ERROR_CEREMONY_ABORTED", status: 400, statusText: "BAD_REQUEST" },
        });
        const onError = vi.fn();
        const { getByLabelText } = render(<Door enabled onError={onError} />);

        fireEvent.pointerDown(getByLabelText("Email"));
        await flush();

        expect(onError).not.toHaveBeenCalled();
      });
    });

    describe("and nobody supplied an error channel at all", () => {
      it("does not throw for a refusal with nowhere to go", async () => {
        passkeyMock.mockResolvedValueOnce({
          data: null,
          error: { code: "PASSKEY_NOT_FOUND", status: 400, statusText: "BAD_REQUEST" },
        });
        const { getByLabelText } = render(<Door enabled />);

        fireEvent.pointerDown(getByLabelText("Email"));

        await flush();
        expect(passkeyMock).toHaveBeenCalled();
        expect(getByLabelText("Email")).toBeDefined();
      });
    });
  });
});
