/**
 * @vitest-environment jsdom
 * The other ways in must not stay live once a passkey ceremony has handed
 * the screen to the browser — a second click would open a competing prompt.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { SignInMethod } from "@langwatch/identity-contract";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { passkeyMock } = vi.hoisted(() => ({
  passkeyMock: vi.fn(),
}));

vi.mock("../../../behavior/auth-client.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof authClientModule>();
  return {
    ...actual,
    authClient: { signIn: { passkey: passkeyMock } },
  };
});

import type * as authClientModule from "../../../behavior/auth-client.tsx";
import { WithTestAuthHost } from "../../../testing.tsx";
import { AlternativeMethods, SignInMethodPicker } from "../sign-in-method-picker.tsx";

const METHOD_SET: readonly SignInMethod[] = [
  { id: "passkey", kind: "passkey", connectionId: null },
  { id: "google", kind: "federated", connectionId: null },
];

/**
 * A promise this test resolves on its own schedule, standing in for a WebAuthn ceremony that has
 * been handed to the browser and is still open.
 */
function pendingCeremony(): { promise: Promise<unknown>; resolve: (value: unknown) => void } {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const renderPicker = () =>
  renderWithDesignSystem(
    <SignInMethodPicker
      methodSet={METHOD_SET}
      reasonCode="no_domain_match"
      onFederatedMethodChosen={vi.fn()}
      onPasskeyError={vi.fn()}
    />,
  );

const renderAlternatives = () =>
  renderWithDesignSystem(
    <AlternativeMethods
      methodSet={METHOD_SET}
      onFederatedMethodChosen={vi.fn()}
      onPasskeyError={vi.fn()}
    />,
  );

afterEach(() => {
  cleanup();
  passkeyMock.mockReset();
});

describe("given the full method picker", () => {
  describe("when no ceremony is running", () => {
    it("leaves the other methods live", async () => {
      renderPicker();

      expect(screen.getByRole("button", { name: /Google/i }).closest("[inert]")).toBeNull();
    });
  });

  describe("when a passkey ceremony is in flight", () => {
    beforeEach(async () => {
      const ceremony = pendingCeremony();
      passkeyMock.mockReturnValue(ceremony.promise);
      const user = userEvent.setup();
      renderPicker();
      await user.click(screen.getByTestId("passkey-sign-in"));
    });

    it("stands the other methods back, dimmed and unclickable", async () => {
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /Google/i }).closest("[inert]")).not.toBeNull(),
      );
    });

    it("takes no second press on the seat that started it", async () => {
      // The seat that started the ceremony is never stood back from its own
      // busy flag — it already shows its own working state.
      expect(screen.getByTestId("passkey-sign-in").closest("[inert]")).toBeNull();
    });
  });

  describe("when the ceremony ends", () => {
    it("enables every method again", async () => {
      const ceremony = pendingCeremony();
      passkeyMock.mockReturnValue(ceremony.promise);
      const user = userEvent.setup();
      renderPicker();

      await user.click(screen.getByTestId("passkey-sign-in"));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /Google/i }).closest("[inert]")).not.toBeNull(),
      );

      ceremony.resolve({ error: { status: 400, code: "PASSKEY_NOT_FOUND" } });

      await waitFor(() =>
        expect(screen.getByRole("button", { name: /Google/i }).closest("[inert]")).toBeNull(),
      );
    });
  });
});

describe("given the alternative methods rail", () => {
  describe("when a passkey ceremony is in flight", () => {
    it("stands the federated buttons back", async () => {
      const ceremony = pendingCeremony();
      passkeyMock.mockReturnValue(ceremony.promise);
      const user = userEvent.setup();
      renderAlternatives();

      await user.click(screen.getByTestId("passkey-sign-in"));

      await waitFor(() =>
        expect(screen.getByRole("button", { name: /Google/i }).closest("[inert]")).not.toBeNull(),
      );
    });
  });
});

describe("given a development deployment offering only google", () => {
  /** @scenario "The sign-in screen offers only the configured providers in every environment" */
  it("offers only google", () => {
    renderWithDesignSystem(
      <WithTestAuthHost publicEnvironment={{ NODE_ENV: "development" }}>
        <AlternativeMethods
          methodSet={METHOD_SET}
          onFederatedMethodChosen={vi.fn()}
          onPasskeyError={vi.fn()}
        />
      </WithTestAuthHost>,
    );

    expect(screen.getByRole("button", { name: /Google/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Microsoft/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /GitHub/i })).toBeNull();
  });
});
