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

const { passkeyMock, navigateMock } = vi.hoisted(() => ({
  passkeyMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("../../../behavior/auth-client.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof authClientModule>();
  return {
    ...actual,
    authClient: { signIn: { passkey: passkeyMock } },
    navigate: navigateMock,
  };
});

import type * as authClientModule from "../../../behavior/auth-client.tsx";
import { PASSKEY_ON_THIS_DEVICE_STORAGE_KEY } from "../../../model/passkey-on-this-device.ts";
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

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(PASSKEY_ON_THIS_DEVICE_STORAGE_KEY, "1");
});

afterEach(() => {
  cleanup();
  passkeyMock.mockReset();
});

describe("given a browser that has never used or made a passkey", () => {
  beforeEach(() => window.localStorage.clear());

  /** @scenario "The passkey button waits until this browser has used a passkey" */
  it("offers no passkey button on the picker or the rail", () => {
    renderPicker();
    renderAlternatives();

    expect(screen.queryByTestId("passkey-sign-in")).toBeNull();
    expect(screen.getAllByRole("button", { name: /Google/i })).toHaveLength(2);
  });

  it("still offers it where the account itself holds a passkey", () => {
    renderWithDesignSystem(
      <SignInMethodPicker
        methodSet={METHOD_SET}
        reasonCode="account_methods"
        onFederatedMethodChosen={vi.fn()}
        onPasskeyError={vi.fn()}
      />,
    );

    expect(screen.getByTestId("passkey-sign-in")).toBeTruthy();
  });

  it("keeps a passkey-only installation's one way in", () => {
    renderWithDesignSystem(
      <SignInMethodPicker
        methodSet={[{ id: "passkey", kind: "passkey", connectionId: null }]}
        reasonCode="no_domain_match"
        onFederatedMethodChosen={vi.fn()}
        onPasskeyError={vi.fn()}
      />,
    );

    expect(screen.getByTestId("passkey-sign-in")).toBeTruthy();
  });
});

describe("given a browser that has used a passkey before", () => {
  /** @scenario "A browser that has used a passkey is offered the passkey button" */
  it("offers the passkey button on the picker and the rail", () => {
    renderPicker();
    renderAlternatives();

    expect(screen.getAllByTestId("passkey-sign-in")).toHaveLength(2);
  });
});

describe("when a passkey sign-in succeeds", () => {
  /** @scenario "A passkey that works here is remembered without naming anybody" */
  it("remembers a bare flag, with no address or account id", async () => {
    window.localStorage.clear();
    passkeyMock.mockResolvedValue({ data: { user: { id: "user_1", email: "sam@example.com" } } });
    renderWithDesignSystem(
      <SignInMethodPicker
        methodSet={METHOD_SET}
        reasonCode="account_methods"
        onFederatedMethodChosen={vi.fn()}
        onPasskeyError={vi.fn()}
      />,
    );

    await userEvent.setup().click(screen.getByTestId("passkey-sign-in"));

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(window.localStorage.getItem(PASSKEY_ON_THIS_DEVICE_STORAGE_KEY)).toBe("1");
    const everything = Object.keys(window.localStorage)
      .map((key) => `${key}=${window.localStorage.getItem(key)}`)
      .join(";");
    expect(everything).not.toMatch(/sam@example\.com|user_1/);
  });
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
