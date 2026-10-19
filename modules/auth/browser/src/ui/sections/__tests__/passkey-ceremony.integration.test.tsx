/**
 * @vitest-environment jsdom
 * The waiting state a deliberately started WebAuthn ceremony puts the card into.
 * Spec: specs/identity/signin-signup-screens.feature
 */
import { readFileSync } from "node:fs";

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { RoutingDecision, SignInMethod } from "@langwatch/identity-contract";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { routeMock, passkeySignInMock, navigateMock } = vi.hoisted(() => ({
  routeMock: vi.fn(),
  passkeySignInMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("../../../behavior/auth-api.ts", () => ({
  authApi: {
    auth: {
      route: {
        useMutation: () => ({ mutateAsync: routeMock, isPending: false, error: null }),
      },
      requestSignUpVerification: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
      },
      priorSession: { useQuery: () => ({ data: undefined }) },
    },
    user: {
      register: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
      },
    },
  },
}));

vi.mock("../../../behavior/use-public-env.ts", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: false } }),
}));

vi.mock("../../../behavior/auth-client.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof authClientModule>();
  return {
    ...actual,
    authClient: { signIn: { passkey: passkeySignInMock } },
    signIn: vi.fn(),
    useSession: () => ({ data: null }),
    navigate: navigateMock,
  };
});

vi.mock("../../../behavior/browser-navigation.ts", () => ({
  replaceLocation: vi.fn(),
  hardNavigate: vi.fn(),
  reloadPage: vi.fn(),
}));

vi.mock("../../../behavior/use-route.ts", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

import type * as authClientModule from "../../../behavior/auth-client.tsx";
import { endPasskeyCeremony } from "../../../behavior/passkey-ceremony.store.ts";
import { PASSKEY_ON_THIS_DEVICE_STORAGE_KEY } from "../../../model/passkey-on-this-device.ts";
import { _resetTwoStepChallengeForTests } from "../../../model/two-step-challenge.ts";
import { IdentifierFirstSignIn } from "../identifier-first-sign-in.tsx";

const passwordMethod: SignInMethod = { id: "password", kind: "password", connectionId: null };
const passkeyMethod: SignInMethod = { id: "passkey", kind: "passkey", connectionId: null };
const oktaMethod: SignInMethod = { id: "okta", kind: "federated", connectionId: "org:acme" };

const pickerWithPasskey: RoutingDecision = {
  outcome: "method_picker",
  methodSet: [passwordMethod, passkeyMethod],
  reasonCode: "no_domain_match",
};

const accountWithPasskey: RoutingDecision = {
  outcome: "method_picker",
  methodSet: [passkeyMethod, passwordMethod, oktaMethod],
  reasonCode: "account_methods",
};

const renderScreen = () => renderWithDesignSystem(<IdentifierFirstSignIn />);

/** A ceremony that never resolves, so the panel stays up to be looked at. */
const neverAnswers = () => new Promise<never>(() => void 0);

const startCeremony = async () => {
  const user = userEvent.setup();
  renderScreen();
  await user.click(await screen.findByTestId("passkey-sign-in"));
  await screen.findByTestId("passkey-ceremony");
  return user;
};

const enterEmail = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(await screen.findByLabelText(/email/i), "sam@example.com");
  await user.click(screen.getByRole("button", { name: /^continue$/i }));
};

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("the passkey ceremony's waiting state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMock.mockResolvedValue(pickerWithPasskey);
    passkeySignInMock.mockImplementation(neverAnswers);
    window.localStorage.clear();
    window.localStorage.setItem(PASSKEY_ON_THIS_DEVICE_STORAGE_KEY, "1");
    _resetTwoStepChallengeForTests();
  });

  afterEach(() => {
    act(() => endPasskeyCeremony());
    cleanup();
    vi.useRealTimers();
  });

  describe("given a deployment that offers passkeys", () => {
    describe("when somebody asks to sign in with one", () => {
      /** @scenario "A ceremony in flight becomes a state of the card, not a spinner on a button" */
      it("turns the card into the waiting state and takes the method rail down", async () => {
        await startCeremony();

        expect(screen.getByRole("heading", { name: /use your passkey/i })).toBeTruthy();
        expect(screen.getByTestId("passkey-ceremony-glyph")).toBeTruthy();
        expect(screen.queryByTestId("passkey-sign-in")).toBeNull();
      });

      /** @scenario "The waiting state admits the prompt is not ours" */
      it("says whose prompt it is and where it may open", async () => {
        await startCeremony();

        const explainer = screen.getByTestId("passkey-ceremony-explainer").textContent;
        expect(explainer).toMatch(/your browser or device/i);
        expect(explainer).toMatch(/another device/i);
        expect(explainer).not.toMatch(/we are|signing you in|langwatch/i);
      });

      /** @scenario "Both ways out are on the waiting state" */
      it("offers cancelling and the other methods, and cancelling reports no failure", async () => {
        const user = await startCeremony();

        expect(screen.getByTestId("passkey-ceremony-other-methods")).toBeTruthy();
        await user.click(screen.getByTestId("passkey-ceremony-cancel"));

        await waitFor(() => expect(screen.queryByTestId("passkey-ceremony")).toBeNull());
        expect(await screen.findByTestId("passkey-sign-in")).toBeTruthy();
        expect(screen.queryByRole("alert")).toBeNull();
      });

      /** @scenario "Both ways out are on the waiting state" */
      it("takes the other-methods way out back to the methods too", async () => {
        const user = await startCeremony();

        await user.click(screen.getByTestId("passkey-ceremony-other-methods"));

        expect(await screen.findByTestId("passkey-sign-in")).toBeTruthy();
        expect(screen.queryByRole("alert")).toBeNull();
      });
    });

    describe("when the device never answers", () => {
      /** @scenario "A device that never answers is told the truth" */
      it("says we did not hear back, and offers to try again or use another way", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        renderScreen();
        await user.click(await screen.findByTestId("passkey-sign-in"));
        await screen.findByTestId("passkey-ceremony");

        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_000);
        });

        expect(
          screen.getByRole("heading", { name: /didn't hear back from your device/i }),
        ).toBeTruthy();
        expect(screen.getByTestId("passkey-ceremony-retry")).toBeTruthy();
        expect(screen.getByTestId("passkey-ceremony-other-methods")).toBeTruthy();
        const explainer = screen.getByTestId("passkey-ceremony-explainer").textContent;
        expect(explainer).toMatch(/nothing was sent/i);
        expect(explainer).not.toMatch(/fail|wrong|your fault/i);

        await user.click(screen.getByTestId("passkey-ceremony-retry"));
        expect(passkeySignInMock).toHaveBeenCalledTimes(2);
        expect(screen.getByRole("heading", { name: /use your passkey/i })).toBeTruthy();
      });
    });
  });

  describe("given a passkey offered from the address field itself", () => {
    /** @scenario "The passkey offered from the address field never draws a waiting state" */
    it("is not wired to the ceremony store at all", () => {
      const autofill = read("../../../behavior/use-passkey-autofill.ts");

      expect(autofill).not.toContain("startPasskeyCeremony");
      expect(autofill).not.toContain("passkey-ceremony");
    });
  });

  describe("given somebody who has asked for less motion", () => {
    /** @scenario "The waiting glyph stops breathing when less motion is asked for" */
    it("keeps the glyph and every word, and declares the breath only where motion is welcome", async () => {
      await startCeremony();

      expect(screen.getByTestId("passkey-ceremony-glyph")).toBeTruthy();
      expect(screen.getByTestId("passkey-ceremony-explainer")).toBeTruthy();
      expect(screen.getByTestId("passkey-ceremony-cancel")).toBeTruthy();

      const styles = read("../../elements/auth-front-door.css");
      const breath = styles.indexOf("animation: lw-front-door-breathe");
      expect(breath).toBeGreaterThan(-1);
      const guard = styles.lastIndexOf("@media (prefers-reduced-motion: no-preference)", breath);
      expect(guard).toBeGreaterThan(-1);
      expect(styles.slice(guard, breath)).not.toContain("\n}");
    });
  });

  describe("given an account the router says holds a passkey", () => {
    /** @scenario "An account with a passkey is asked for it, not offered a button" */
    it("starts the ceremony on the address submit, and the card is the waiting state", async () => {
      routeMock.mockResolvedValue(accountWithPasskey);
      const user = userEvent.setup();

      renderScreen();
      await enterEmail(user);

      expect(await screen.findByTestId("passkey-ceremony")).toBeTruthy();
      expect(passkeySignInMock).toHaveBeenCalledTimes(1);
    });

    /** @scenario "The rest of the rail stands back while a ceremony runs" */
    it("brings every method back undimmed once a declined ceremony returns", async () => {
      routeMock.mockResolvedValue(accountWithPasskey);
      passkeySignInMock.mockResolvedValue({ error: { status: 0 } });
      const user = userEvent.setup();

      const { container } = renderScreen();
      await enterEmail(user);

      await waitFor(() => {
        expect(container.querySelector('input[type="password"]')).not.toBeNull();
      });
      expect(screen.queryByTestId("passkey-ceremony")).toBeNull();
      expect(container.querySelector("[data-standing-back]")).toBeNull();
      for (const button of screen.getAllByRole("button")) {
        expect(button).not.toHaveProperty("disabled", true);
      }
    });

    /** @scenario "The rest of the rail stands back while a ceremony runs" */
    it("lets a ceremony that never answers be cancelled", async () => {
      routeMock.mockResolvedValue(accountWithPasskey);
      const user = userEvent.setup();

      renderScreen();
      await enterEmail(user);
      await user.click(await screen.findByTestId("passkey-ceremony-cancel"));

      expect(await screen.findByTestId("passkey-sign-in")).toBeTruthy();
      expect(screen.queryByTestId("passkey-ceremony")).toBeNull();
      expect(passkeySignInMock).toHaveBeenCalledTimes(1);
    });
  });
});
