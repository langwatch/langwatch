/**
 * @vitest-environment jsdom
 * A refused link that names the connection governing the address points at that connection.
 * @see specs/auth/sso-wrong-provider-recovery.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }));

vi.mock("../../../behavior/auth-client.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof authClientModule>();
  return {
    ...actual,
    signIn: signInMock,
    useSession: () => ({ data: null, status: "unauthenticated", update: async () => undefined }),
  };
});

import type * as authClientModule from "../../../behavior/auth-client.tsx";
import { WithTestAuthHost } from "../../../testing.tsx";
import { FEDERATED_LOGOUT_PATH, SignInErrorScreen } from "../sign-in-error-screen.tsx";

function renderErrorRoute(query: Record<string, string>) {
  return render(
    <MemoryRouter initialEntries={["/auth/error"]}>
      <DesignSystemProvider forcedTheme="light">
        <WithTestAuthHost route={{ pathname: "/auth/error", query }}>
          <SignInErrorScreen />
        </WithTestAuthHost>
      </DesignSystemProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  signInMock.mockReset();
});

describe("given a refused link whose address an organization's connection governs", () => {
  const refused = { error: "account_not_linked", error_description: "ssoc_acme" };

  describe("when the error page renders", () => {
    /** @scenario "Signing in with the wrong method explains what to do and names the right method" */
    it("explains the account exists and points at the organization's sign-in, not settings", () => {
      renderErrorRoute(refused);

      expect(screen.getByText("Account already exists")).toBeTruthy();
      expect(screen.getByText(/requires its single sign-on/i)).toBeTruthy();
      expect(
        screen.getByRole("button", { name: /continue with your organization's sign-in/i }),
      ).toBeTruthy();
      expect(document.body.textContent).not.toMatch(/Settings > Security/);
      expect(screen.getByRole("link", { name: /sign out.*try again/i }).getAttribute("href")).toBe(
        FEDERATED_LOGOUT_PATH,
      );
    });

    /** @scenario "The error page does not auto-redirect back to the identity provider" */
    it("dials the connection only when the person asks", () => {
      renderErrorRoute(refused);
      expect(signInMock).not.toHaveBeenCalled();

      fireEvent.click(
        screen.getByRole("button", { name: /continue with your organization's sign-in/i }),
      );

      expect(signInMock).toHaveBeenCalledWith("ssoc_acme", { callbackUrl: "/" });
    });
  });

  describe("when the description is not a connection identifier", () => {
    /** @scenario "Recovery works the same when the org's required method is not yet known" */
    it("falls back to signing in with the method used before", () => {
      renderErrorRoute({ error: "account_not_linked", error_description: "https://evil.test" });

      expect(screen.getByText(/sign in the way you did before/i)).toBeTruthy();
      expect(screen.queryByRole("button", { name: /organization's sign-in/i })).toBeNull();
    });
  });
});
