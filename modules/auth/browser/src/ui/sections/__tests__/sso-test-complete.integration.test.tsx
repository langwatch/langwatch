/**
 * @vitest-environment jsdom
 * The screen a single sign-on test sign-in lands on; only the session and the
 * test-arrival read are stubbed. Spec: specs/identity/sso-activation.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { SsoTestArrivalStanding } from "@langwatch/identity-contract";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type SessionAnswer = { data: { user: { email: string | null } } | null };

const { signOutMock, sessionRef, arrivalRef } = vi.hoisted(() => {
  const session: { current: SessionAnswer } = {
    current: { data: { user: { email: "admin@acme1.test" } } },
  };
  const arrival: { current: SsoTestArrivalStanding } = {
    current: {
      testing: true,
      connectionId: "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m",
      organizationId: "org_acme",
      organizationName: "Acme",
    },
  };
  return { signOutMock: vi.fn(), sessionRef: session, arrivalRef: arrival };
});

vi.mock("../../../behavior/auth-api.ts", () => ({
  authApi: {
    identity: {
      myTestArrival: { useQuery: () => ({ data: arrivalRef.current }) },
    },
  },
}));

vi.mock("../../../behavior/auth-client.tsx", () => ({
  signOut: signOutMock,
  useSession: () => sessionRef.current,
}));

import SsoTestComplete from "../sso-test-complete-screen.tsx";

const renderScreen = () =>
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
    it("says the test worked, names the address and the organization, and offers the way back", () => {
      renderScreen();

      expect(screen.getByText(/that test sign-in worked/i)).toBeDefined();
      expect(screen.getByText(/admin@acme1\.test/)).toBeDefined();
      expect(screen.getByText(/member of Acme yet/)).toBeDefined();

      fireEvent.click(screen.getByTestId("sso-test-complete-sign-out"));
      expect(signOutMock).toHaveBeenCalled();
    });
  });

  describe("given the session has not answered with an address yet", () => {
    it("still says what happened rather than rendering a gap", () => {
      const held = sessionRef.current;
      sessionRef.current = { data: null };
      try {
        renderScreen();

        expect(screen.getByText(/that test sign-in worked/i)).toBeDefined();
      } finally {
        sessionRef.current = held;
      }
    });
  });

  describe("given the server does not answer that this was a test", () => {
    it("names no organization it cannot vouch for", () => {
      const held = arrivalRef.current;
      arrivalRef.current = { testing: false };
      try {
        renderScreen();

        expect(screen.getByText(/member of your organization yet/)).toBeDefined();
      } finally {
        arrivalRef.current = held;
      }
    });
  });
});
