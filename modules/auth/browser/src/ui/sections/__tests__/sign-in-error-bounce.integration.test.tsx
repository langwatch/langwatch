/**
 * @vitest-environment jsdom
 * The error route spends a native-social refusal by dialling the connection it named, and
 * never follows a target that is not a connection identifier.
 * @see specs/identity/native-social-at-a-claimed-domain.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
import { SignInErrorScreen } from "../sign-in-error-screen.tsx";

function renderErrorRoute(query: Record<string, string>) {
  return render(
    <MemoryRouter initialEntries={["/auth/error"]}>
      <ChakraProvider value={defaultSystem}>
        <WithTestAuthHost route={{ pathname: "/auth/error", query }}>
          <SignInErrorScreen />
        </WithTestAuthHost>
      </ChakraProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  signInMock.mockReset();
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
