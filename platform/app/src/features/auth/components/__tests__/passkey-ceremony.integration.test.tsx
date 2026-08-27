/**
 * @vitest-environment jsdom
 *
 * The waiting state a WebAuthn ceremony puts the card into.
 *
 * Everything here is about one distinction: a ceremony somebody DELIBERATELY
 * started owes them a state that says what is being waited on, and the
 * conditional offer from the address field owes them nothing at all, because
 * nobody started it.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { RoutingDecision, SignInMethod } from "@langwatch/identity";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  routeMock,
  passkeySignInMock,
  signInMock,
  navigateMock,
  searchParamsRef,
} = vi.hoisted(() => ({
  routeMock: vi.fn(),
  passkeySignInMock: vi.fn(),
  signInMock: vi.fn(),
  navigateMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams("") },
}));

vi.mock("~/utils/api", () => ({
  api: {
    auth: {
      route: {
        useMutation: () => ({
          mutateAsync: routeMock,
          isPending: false,
          error: null,
        }),
      },
      requestSignUpVerification: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: false } }),
}));

vi.mock("~/utils/auth-client", () => ({
  authClient: { signIn: { passkey: passkeySignInMock } },
  signIn: signInMock,
  useSession: () => ({ data: null }),
  navigate: navigateMock,
  safeRedirectTarget: (url?: string) => url ?? "/",
}));

vi.mock("~/utils/browserNavigation", () => ({
  replaceLocation: vi.fn(),
  hardNavigate: vi.fn(),
  reloadPage: vi.fn(),
}));

vi.mock("~/utils/compat/next-navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

vi.mock("~/utils/compat/next-link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { endPasskeyCeremony } from "../../logic/passkeyCeremony";
import { IdentifierFirstSignIn } from "../IdentifierFirstSignIn";

const passwordMethod: SignInMethod = {
  id: "password",
  kind: "password",
  connectionId: null,
};

const passkeyMethod: SignInMethod = {
  id: "passkey",
  kind: "passkey",
  connectionId: null,
};

const oktaMethod: SignInMethod = {
  id: "okta",
  kind: "federated",
  connectionId: "org:acme",
};

const pickerWithPasskey: RoutingDecision = {
  outcome: "method_picker",
  methodSet: [passwordMethod, passkeyMethod],
  reasonCode: "no_domain_match",
};

const renderScreen = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <IdentifierFirstSignIn />
    </ChakraProvider>,
  );

/** A ceremony that never resolves, so the panel stays up to be looked at. */
const neverAnswers = () => new Promise<never>(() => void 0);

const startCeremony = async () => {
  const user = userEvent.setup();
  renderScreen();
  const button = await screen.findByTestId("passkey-sign-in");
  await user.click(button);
  await screen.findByTestId("passkey-ceremony");
  return user;
};

const authStyles = readFileSync(
  join(__dirname, "..", "..", "auth.css"),
  "utf8",
);

describe("the passkey ceremony's waiting state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMock.mockResolvedValue(pickerWithPasskey);
    passkeySignInMock.mockImplementation(neverAnswers);
    searchParamsRef.current = new URLSearchParams("");
  });

  afterEach(() => {
    act(() => endPasskeyCeremony());
    cleanup();
    vi.useRealTimers();
  });

  describe("given a deployment that offers passkeys", () => {
    describe("when somebody asks to sign in with one", () => {
      /** @scenario A ceremony in flight becomes a state of the card, not a spinner on a button */
      it("turns the card into the waiting state and takes the method rail down", async () => {
        await startCeremony();

        expect(
          screen.getByRole("heading", { name: /use your passkey/i }),
        ).toBeTruthy();
        expect(screen.getByTestId("passkey-ceremony-glyph")).toBeTruthy();
        // The rail is gone rather than sitting live under a busy button,
        // which is what invites a second ceremony on top of the first.
        expect(screen.queryByTestId("passkey-sign-in")).toBeNull();
      });

      /** @scenario The waiting state admits the prompt is not ours */
      it("says whose prompt it is and where it may open", async () => {
        await startCeremony();

        const explainer = screen.getByTestId("passkey-ceremony-explainer");
        expect(explainer.textContent).toMatch(/your browser or device/i);
        expect(explainer.textContent).toMatch(/another device/i);
        // Never a claim that we are doing something. We are not: the browser
        // has the screen.
        expect(explainer.textContent).not.toMatch(/we are|signing you in/i);
      });

      /** @scenario Both ways out are on the waiting state */
      /** @scenario Cancelling the device prompt is not a dead end */
      it("offers cancelling and the other methods, and cancelling reports no failure", async () => {
        const user = await startCeremony();

        expect(
          screen.getByTestId("passkey-ceremony-other-methods"),
        ).toBeTruthy();
        await user.click(screen.getByTestId("passkey-ceremony-cancel"));

        await waitFor(() => {
          expect(screen.queryByTestId("passkey-ceremony")).toBeNull();
        });
        // Back on the methods, with nothing said about having failed.
        expect(await screen.findByTestId("passkey-sign-in")).toBeTruthy();
        expect(screen.queryByRole("alert")).toBeNull();
      });
    });

    describe("when the device never answers", () => {
      /** @scenario A device that never answers is told the truth */
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
          screen.getByRole("heading", {
            name: /didn't hear back from your device/i,
          }),
        ).toBeTruthy();
        expect(screen.getByTestId("passkey-ceremony-retry")).toBeTruthy();
        expect(
          screen.getByTestId("passkey-ceremony-other-methods"),
        ).toBeTruthy();
        // Not somebody's fault, and not called one.
        const explainer = screen.getByTestId("passkey-ceremony-explainer");
        expect(explainer.textContent).toMatch(/nothing was sent/i);
      });
    });
  });

  describe("given a passkey offered from the address field itself", () => {
    describe("when the browser is holding the conditional request", () => {
      /** @scenario The passkey offered from the address field never draws a waiting state */
      it("draws no waiting state, because nobody started it", async () => {
        renderScreen();
        // The address step is up and the conditional offer arms on a gesture,
        // which is what `usePasskeyAutofill` does — and it publishes nothing.
        const field = await screen.findByPlaceholderText("you@company.com");
        await userEvent.setup().click(field);

        await waitFor(() => {
          expect(field).toHaveProperty("id");
        });
        expect(screen.queryByTestId("passkey-ceremony")).toBeNull();
      });

      /** @scenario The passkey offered from the address field never draws a waiting state */
      it("is not wired to the ceremony store at all", () => {
        const autofill = readFileSync(
          join(__dirname, "..", "..", "hooks", "usePasskeyAutofill.ts"),
          "utf8",
        );

        // Structural rather than behavioural on purpose: the offer resolves
        // only when somebody PICKS a credential, which a test cannot make a
        // browser do — so what is pinned is that the hook has no way to
        // publish a ceremony even if it wanted to.
        expect(autofill).not.toContain("startPasskeyCeremony");
        expect(autofill).not.toContain("passkeyCeremony");
      });
    });
  });

  describe("given somebody who has asked for less motion", () => {
    describe("when the card is waiting for their device", () => {
      /** @scenario The waiting glyph stops breathing when less motion is asked for */
      it("keeps the glyph and every word, and declares the breath only where motion is welcome", async () => {
        await startCeremony();

        // The mark is THERE. This is the opposite of the castle's rule, which
        // pins its absence: a still glyph over the words is the point, and a
        // panel that lost its mark would lose the thing the eye rests on.
        expect(screen.getByTestId("passkey-ceremony-glyph")).toBeTruthy();
        expect(screen.getByTestId("passkey-ceremony-explainer")).toBeTruthy();
        expect(screen.getByTestId("passkey-ceremony-cancel")).toBeTruthy();

        // And the breath exists only inside a no-preference block, so for
        // somebody who asked for less motion it never starts at all rather
        // than starting and being switched off.
        const breath = authStyles.indexOf("animation: lw-auth-breathe");
        expect(breath).toBeGreaterThan(-1);
        const guard = authStyles.lastIndexOf(
          "@media (prefers-reduced-motion: no-preference)",
          breath,
        );
        expect(guard).toBeGreaterThan(-1);
        // Nothing closes that block between the guard and the animation.
        expect(authStyles.slice(guard, breath)).not.toContain("\n}");
      });
    });
  });

  describe("given an account the router says holds a passkey", () => {
    const accountWithPasskey: RoutingDecision = {
      outcome: "method_picker",
      methodSet: [passkeyMethod, passwordMethod],
      reasonCode: "account_methods",
    };

    const enterEmail = async (user: ReturnType<typeof userEvent.setup>) => {
      const field = await screen.findByLabelText(/email/i);
      await user.type(field, "sam@example.com");
      await user.click(screen.getByRole("button", { name: /^continue$/i }));
    };

    describe("when the address step routes to it", () => {
      /** @scenario An account with a passkey is asked for it, not offered a button */
      it("starts the ceremony without waiting for a second click", async () => {
        routeMock.mockResolvedValue(accountWithPasskey);
        passkeySignInMock.mockImplementation(neverAnswers);
        const user = userEvent.setup();

        renderScreen();
        await enterEmail(user);

        // The submit WAS the gesture. Nobody presses a button to reach the
        // prompt that the thing they just did was asking for.
        expect(await screen.findByTestId("passkey-ceremony")).toBeTruthy();
        expect(passkeySignInMock).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the ceremony is declined", () => {
      /** @scenario A declined passkey falls back to the next method, and does not ask again */
      it("falls back to the account's next method and never re-starts on its own", async () => {
        routeMock.mockResolvedValue(accountWithPasskey);
        // A prompt the person closed: status 0, which the button reads as a
        // decision rather than a failure worth shouting about.
        passkeySignInMock.mockResolvedValue({ error: { status: 0 } });
        const user = userEvent.setup();

        const { container } = renderScreen();
        await enterEmail(user);

        // The rail comes back with the password this account holds, and the
        // passkey still offered as a button to try again deliberately.
        await waitFor(() => {
          expect(
            container.querySelector('input[type="password"]'),
          ).not.toBeNull();
        });
        expect(screen.queryByTestId("passkey-ceremony")).toBeNull();
        expect(screen.getByTestId("passkey-sign-in")).toBeTruthy();
        // Exactly one automatic attempt, ever. A screen that re-prompts every
        // time it re-renders is a door that will not let go.
        expect(passkeySignInMock).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the method set is the instance's rather than the account's", () => {
      /** @scenario The rest of the rail stands back while a ceremony runs */
      it("dims every other method while it runs and brings them all back after", async () => {
        routeMock.mockResolvedValue({
          outcome: "method_picker",
          methodSet: [passkeyMethod, passwordMethod, oktaMethod],
          reasonCode: "account_methods",
        } satisfies RoutingDecision);
        // A prompt somebody closed. The rail must come back from THIS exit as
        // surely as from a success, which is the case Alex hit.
        passkeySignInMock.mockResolvedValue({ error: { status: 0 } });
        const user = userEvent.setup();

        const { container } = renderScreen();
        await enterEmail(user);

        // Once the ceremony has returned, nothing is left standing back and
        // nothing is left disabled — not the provider, not the password form.
        await waitFor(() => {
          expect(
            container.querySelector('input[type="password"]'),
          ).not.toBeNull();
        });
        expect(container.querySelector("[data-standing-back]")).toBeNull();
        for (const button of screen.getAllByRole("button")) {
          expect(button).not.toBeDisabled();
        }
      });

      /** @scenario The rest of the rail stands back while a ceremony runs */
      it("holds the rail back for as long as the ceremony is waiting", async () => {
        routeMock.mockResolvedValue({
          outcome: "method_picker",
          methodSet: [passkeyMethod, passwordMethod, oktaMethod],
          reasonCode: "account_methods",
        } satisfies RoutingDecision);
        passkeySignInMock.mockImplementation(neverAnswers);
        const user = userEvent.setup();

        renderScreen();
        await enterEmail(user);

        // The card is the waiting state on this door, so the rail is not on
        // screen at all — which is the strongest form of standing back, and
        // the reason a live rail under a system sheet cannot happen here.
        expect(await screen.findByTestId("passkey-ceremony")).toBeTruthy();
        expect(screen.queryByTestId("method-picker")).toBeNull();
      });

      /** @scenario An account with a passkey is asked for it, not offered a button */
      it("starts nothing, and offers the button as before", async () => {
        routeMock.mockResolvedValue(pickerWithPasskey);
        passkeySignInMock.mockImplementation(neverAnswers);
        const user = userEvent.setup();

        renderScreen();
        await enterEmail(user);

        expect(await screen.findByTestId("passkey-sign-in")).toBeTruthy();
        expect(screen.queryByTestId("passkey-ceremony")).toBeNull();
        expect(passkeySignInMock).not.toHaveBeenCalled();
      });
    });
  });
});
