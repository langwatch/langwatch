/**
 * @vitest-environment jsdom
 *
 * The rail of methods beside the address field.
 *
 * One rule, and everything here is a reading of it: a button on the rail is an
 * offer to dial a provider, so the rail is exactly what the deployment's
 * routing decision offered and nothing else. A build flavour is not a reason
 * to add to it — an offer that exists only where nobody can complete it is how
 * a rail ships that nobody ever watched fail.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { SignInMethod } from "@langwatch/identity";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/auth-client", () => ({
  authClient: { signIn: { passkey: vi.fn() } },
  signIn: vi.fn(),
  navigate: vi.fn(),
  safeRedirectTarget: (url?: string) => url ?? "/",
}));

import {
  AlternativeMethods,
  hasAlternativeMethods,
} from "../SignInMethodPicker";

const federated = (id: string): SignInMethod => ({
  id,
  kind: "federated",
  connectionId: null,
});

const PASSWORD: SignInMethod = {
  id: "password",
  kind: "password",
  connectionId: null,
};

const PASSKEY: SignInMethod = {
  id: "passkey",
  kind: "passkey",
  connectionId: null,
};

function renderRail(methodSet: readonly SignInMethod[]): void {
  const wrap = (children: ReactNode) => (
    <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
  );
  render(
    wrap(
      <AlternativeMethods
        methodSet={methodSet}
        onFederatedMethodChosen={vi.fn()}
        onPasskeyError={vi.fn()}
      />,
    ),
  );
}

const railLabels = (): string[] =>
  screen
    .queryAllByRole("button")
    .map((button) => button.textContent?.trim() ?? "");

afterEach(() => {
  cleanup();
});

describe("the rail of alternative sign-in methods", () => {
  describe("given the deployment offers one social provider and a passkey", () => {
    /** @scenario "The rail beside the address offers exactly what the deployment configured" */
    it("draws those two and no other provider", () => {
      renderRail([federated("google"), PASSKEY]);

      expect(railLabels()).toEqual([
        "Continue with a passkey",
        "Continue with Google",
      ]);
    });

    /*
     * The regression this file exists for. The rail used to fold the cloud's
     * whole social set in whenever `import.meta.env.DEV` was true, which is
     * every development and preview build — so the people most likely to
     * notice a broken provider were the only ones who could not, and a
     * deployment that mounted one provider showed three.
     *
     * A test run IS a development build by that measure, which is what makes
     * this assertion bite rather than pass by accident.
     */
    /** @scenario "The rail beside the address offers exactly what the deployment configured" */
    it("adds nothing of its own on a development build", () => {
      expect(import.meta.env.DEV).toBe(true);

      renderRail([federated("google"), PASSKEY]);

      expect(screen.queryByText("Continue with GitHub")).toBeNull();
      expect(screen.queryByText("Continue with Microsoft")).toBeNull();
    });
  });

  describe("given the deployment mounted several social providers", () => {
    /** @scenario "The rail beside the address offers exactly what the deployment configured" */
    it("draws them in the order the decision named them", () => {
      renderRail([
        federated("google"),
        federated("github"),
        federated("azure-ad"),
      ]);

      expect(railLabels()).toEqual([
        "Continue with Google",
        "Continue with GitHub",
        "Continue with Microsoft",
      ]);
    });
  });

  describe("given the deployment offers no method but the address and password", () => {
    /** @scenario "With nothing to offer beside the address, no divider is drawn" */
    it("reports there is nothing to draw a divider over", () => {
      // The divider belongs to the caller, and this is what it asks before
      // drawing one. An orphan "OR" above an empty space is what a `true`
      // here would put on the screen.
      expect(hasAlternativeMethods([PASSWORD])).toBe(false);
    });

    /** @scenario "With nothing to offer beside the address, no divider is drawn" */
    it("draws no button even when rendered anyway", () => {
      renderRail([PASSWORD]);

      expect(railLabels()).toEqual([]);
    });
  });
});
