/**
 * @vitest-environment jsdom
 * Sign-in error UI; regression: federated logout on account collision
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { WithTestAuthHost } from "../../../testing.tsx";
import { FEDERATED_LOGOUT_PATH, SignInError } from "../sign-in-error-screen.tsx";

function renderError(error: string) {
  return render(
    <MemoryRouter initialEntries={[`/auth/error?error=${error}`]}>
      <ChakraProvider value={defaultSystem}>
        <WithTestAuthHost route={{ pathname: "/auth/error", query: { error } }}>
          <SignInError error={error} />
        </WithTestAuthHost>
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
      expect(screen.getByText(/sign out completely and sign in again/i)).toBeTruthy();
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
