/**
 * @vitest-environment jsdom
 * The error route spends a native-social refusal by dialling the connection it named, and
 * never follows a target that is not a connection identifier.
 * @see specs/identity/native-social-at-a-claimed-domain.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real `signIn` resolves to a result or undefined; the page chains on it.
const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn(async () => undefined as unknown) }));

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
import { SignInErrorScreen } from "../sign-in-error-screen.tsx";

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
  signInMock.mockResolvedValue(undefined);
});

describe("a refused native sign-in that named a connection", () => {
  /** @scenario "The error route dials the connection the refusal named" */
  it("dials that connection without asking anything", async () => {
    renderErrorRoute({ error: "SSO_REQUIRED_BY_ORGANIZATION", error_description: "ssoc_acme" });

    await waitFor(() => expect(signInMock).toHaveBeenCalledWith("ssoc_acme", { callbackUrl: "/" }));
    expect(screen.getByText("Taking you to your organization's sign-in")).toBeTruthy();
  });
});

describe("a refusal whose named target is not a connection", () => {
  /** @scenario "A bounce target that is not a connection identifier is refused" */
  it("dials nothing and shows the ordinary refusal", async () => {
    renderErrorRoute({
      error: "SSO_REQUIRED_BY_ORGANIZATION",
      error_description: "https://evil.example.com",
    });

    expect(await screen.findByText("Use your organization's sign-in")).toBeTruthy();
    expect(signInMock).not.toHaveBeenCalled();
  });
});

describe("a refused native sign-in whose connection the server will not dial", () => {
  /** @scenario "A dial the server refuses shows the refusal instead of waiting" */
  it("shows the refusal when the server answers the dial with an error", async () => {
    signInMock.mockResolvedValueOnce({ error: "No provider found for the issuer", status: 404 });
    renderErrorRoute({ error: "SSO_REQUIRED_BY_ORGANIZATION", error_description: "ssoc_gone" });

    expect(await screen.findByText("Use your organization's sign-in")).toBeTruthy();
    expect(signInMock).toHaveBeenCalledWith("ssoc_gone", { callbackUrl: "/" });
    expect(screen.queryByText("Taking you to your organization's sign-in")).toBeNull();
  });

  /** @scenario "A dial the server refuses shows the refusal instead of waiting" */
  it("shows the refusal when the dial itself throws", async () => {
    signInMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderErrorRoute({ error: "SSO_REQUIRED_BY_ORGANIZATION", error_description: "ssoc_gone" });

    expect(await screen.findByText("Use your organization's sign-in")).toBeTruthy();
    expect(screen.queryByText("Taking you to your organization's sign-in")).toBeNull();
  });
});
