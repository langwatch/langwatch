/**
 * @vitest-environment jsdom
 *
 * The screen a single sign-on test sign-in lands on. The tree renders under
 * Chakra; only the session, the tRPC read and the public-env hook are mocked.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockSignOut, sessionRef, arrivalRef } = vi.hoisted(() => ({
  mockSignOut: vi.fn(),
  sessionRef: {
    current: { user: { email: "admin@acme1.test" } } as {
      user: { email: string | null };
    } | null,
  },
  arrivalRef: {
    current: {
      connectionId: "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m",
      organizationId: "org_acme",
      organizationName: "Acme",
    } as { organizationName: string } | null,
  },
}));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({ data: sessionRef.current }),
  signOut: mockSignOut,
}));

vi.mock("~/utils/api", () => ({
  api: {
    identity: {
      myTestArrival: {
        useQuery: () => ({ data: arrivalRef.current }),
      },
    },
  },
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: false } }),
}));

vi.mock("~/features/auth", () => ({
  AuthShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import SsoTestComplete from "../sso-test-complete";

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SsoTestComplete />
    </ChakraProvider>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the screen a test sign-in lands on", () => {
  describe("given an administrator arrived through a connection that is not live", () => {
    /** @scenario "A test arrival is told the test worked and offered the way back" */
    it("says the test worked, names the address and offers the way back", () => {
      renderPage();

      // The headline is the correction: the screen this replaced implied the
      // opposite by offering to create an organization.
      expect(screen.getByText(/that test sign-in worked/i)).toBeDefined();
      expect(screen.getByText(/admin@acme1\.test/)).toBeDefined();
      expect(screen.getByText(/Acme/)).toBeDefined();

      fireEvent.click(screen.getByTestId("sso-test-complete-sign-out"));
      expect(mockSignOut).toHaveBeenCalled();
    });
  });

  describe("given the session has not answered with an address yet", () => {
    it("still says what happened rather than rendering a gap", () => {
      sessionRef.current = null;
      renderPage();

      expect(screen.getByText(/that test sign-in worked/i)).toBeDefined();
      sessionRef.current = { user: { email: "admin@acme1.test" } };
    });
  });
});
