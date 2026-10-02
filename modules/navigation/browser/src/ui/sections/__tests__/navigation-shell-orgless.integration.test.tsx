/**
 * @vitest-environment jsdom
 * Spec: specs/navigation/navigation-v2-landing.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../behavior/use-reachable-products.ts", () => ({
  useReachableProducts: () => ({ reachableProducts: [], isLoading: false }),
}));

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    governance: { resolveHome: { useQuery: () => ({ data: undefined, isError: false }) } },
    identity: {
      myTestArrival: { useQuery: () => ({ data: { testing: false }, isLoading: false }) },
    },
  },
}));

import { WithStubNavigationHost } from "../../../testing.tsx";
import { NavigationShell } from "../navigation-shell.tsx";
import LandingScreen from "../navigation/landing.screen.tsx";

const replaceMock = vi.fn();

describe("the front door at /", () => {
  afterEach(() => {
    cleanup();
    replaceMock.mockReset();
  });

  describe("when a signed-in reader who belongs to no organization opens it", () => {
    /** @scenario The front door sends a reader with no organization to onboarding */
    it("resolves without the chrome and sends them to onboarding", async () => {
      renderWithDesignSystem(
        <WithStubNavigationHost
          readings={{
            organizations: [],
            organization: undefined,
            team: undefined,
            project: undefined,
            currentUser: { id: "user_1", name: "Ada", email: "ada@acme.test", image: null },
            isLoading: false,
            pathname: "/",
            waiting: <div data-testid="waiting" />,
          }}
          actions={{ replace: replaceMock }}
        >
          <NavigationShell>
            <LandingScreen />
          </NavigationShell>
        </WithStubNavigationHost>,
      );

      await waitFor(() => {
        expect(replaceMock).toHaveBeenCalledWith("/onboarding/welcome");
      });
      expect(screen.queryByTestId("product-sidebar")).toBeNull();
    });
  });
});
