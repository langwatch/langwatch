/**
 * @vitest-environment jsdom
 *
 * Unit tests for the sign-in error UI shared by /auth/signin and /auth/error.
 * Renders the real component tree (Chakra + react-router), no shallow
 * rendering and no mocked navigation layer.
 *
 * Regression guard for the "stuck in the sign-in loop" report: when an account
 * collision (wrong sign-in method for an existing email) lands the user on the
 * "Account already exists" page, the recovery action must run a FEDERATED
 * logout (/api/auth/logout, which also clears the Auth0 session) instead of
 * bouncing straight back to /auth/signin. Otherwise the live IdP session
 * silently re-authenticates the same failing identity and the loop repeats.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { FEDERATED_LOGOUT_PATH, SignInError } from "../error";

function renderError(error: string) {
  return render(
    <MemoryRouter initialEntries={[`/auth/error?error=${error}`]}>
      <ChakraProvider value={defaultSystem}>
        <SignInError error={error} />
      </ChakraProvider>
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());

describe("<SignInError/>", () => {
  describe("when an account already exists under a different sign-in method", () => {
    it("shows the 'Account already exists' heading", () => {
      renderError("OAuthAccountNotLinked");
      expect(screen.getByText("Account already exists")).toBeTruthy();
    });

    it("recovers via a federated logout, not a bare bounce back to sign-in", () => {
      renderError("OAuthAccountNotLinked");
      const recovery = screen.getByRole("link", {
        name: /sign out.*try again/i,
      });
      expect(recovery.getAttribute("href")).toBe(FEDERATED_LOGOUT_PATH);
      // The old behaviour linked straight to /auth/signin, which re-auths the
      // still-live IdP session and re-triggers the same failure (the loop).
      expect(recovery.getAttribute("href")).not.toContain("/auth/signin");
    });

    it("steers the user to sign out and use their original / SSO method", () => {
      renderError("OAuthAccountNotLinked");
      expect(
        screen.getByText(/sign out completely and sign in again/i),
      ).toBeTruthy();
      expect(screen.getByText(/method you used originally/i)).toBeTruthy();
    });
  });

  describe("when the organization enforces SSO and the wrong method was used", () => {
    it("shows a friendly heading instead of the raw error code", () => {
      renderError("SSO_PROVIDER_NOT_ALLOWED");
      expect(screen.getByText(/use your organization's sign-in/i)).toBeTruthy();
      expect(screen.queryByText("SSO_PROVIDER_NOT_ALLOWED")).toBeNull();
    });

    it("recovers via a federated logout so the next attempt can pick SSO", () => {
      renderError("SSO_PROVIDER_NOT_ALLOWED");
      const recovery = screen.getByRole("link", {
        name: /sign out.*try again/i,
      });
      expect(recovery.getAttribute("href")).toBe(FEDERATED_LOGOUT_PATH);
    });
  });

  describe("when linking is refused due to a different email (settings flow)", () => {
    it("keeps the user in settings rather than offering a logout", () => {
      renderError("DIFFERENT_EMAIL_NOT_ALLOWED");
      expect(screen.getByText(/can't link this account/i)).toBeTruthy();
      const back = screen.getByRole("link", { name: /back to settings/i });
      expect(back.getAttribute("href")).toBe("/settings/authentication");
    });
  });
});
