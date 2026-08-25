/**
 * @vitest-environment jsdom
 *
 * The Usage page's date-range presets and key-filter chip rebuild their URL
 * with `router.push({ pathname: router.pathname, query })`. When the compat
 * router had no literal route pattern for /gateway/usage, the
 * /settings wildcard resolved the pathname to `/settings/[[...path]]`, the
 * placeholder collapsed to nothing, and every click bounced the browser to
 * the bare settings root (`/settings/?vk=...&days=...`).
 *
 * These render the real page against the real compat layer inside a
 * MemoryRouter and assert the navigation stays on the usage route.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The global test-setup.ts stubs ~/utils/compat/next-router with an inert
// router. The bug under test lives in that module's pattern resolution, so
// these tests need the real one.
vi.unmock("~/utils/compat/next-router");
vi.mock(
  "~/utils/compat/next-router",
  async () => await vi.importActual<object>("~/utils/compat/next-router"),
);

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard:
    () =>
    <P extends object>(Component: React.ComponentType<P>) =>
      Component,
}));

vi.mock("~/components/gateway/AiGatewayLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", slug: "acme" },
    project: undefined,
  }),
}));

const emptySummary = {
  totalUsd: "0.000000",
  totalRequests: 0,
  blockedRequests: 0,
  avgUsdPerRequest: "0.000000",
  byVirtualKey: [],
  byModel: [],
  byDay: [],
};

vi.mock("~/utils/api", () => ({
  api: {
    gatewayUsage: {
      summary: {
        useQuery: () => ({
          data: emptySummary,
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      summaryForVirtualKey: {
        useQuery: () => ({
          data: { ...emptySummary, recentDebits: [] },
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
    virtualKeys: {
      get: {
        useQuery: () => ({
          data: { name: "Canary Gateway Healthcheck" },
          isLoading: false,
        }),
      },
    },
  },
}));

import { MemoryRouter, useLocation } from "react-router";

import GatewayUsagePage from "../usage";

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <span data-testid="probe-pathname">{location.pathname}</span>
      <span data-testid="probe-search">{location.search}</span>
    </>
  );
}

function renderUsagePage(initialUrl: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <GatewayUsagePage />
        <LocationProbe />
      </MemoryRouter>
    </ChakraProvider>,
  );
}

describe("Gateway usage page filter routing", () => {
  beforeEach(() => {
    Object.defineProperty(window, "scrollTo", {
      value: vi.fn(),
      writable: true,
    });
  });
  afterEach(() => cleanup());

  /** @scenario "Changing the window or clearing the key filter keeps the browser on the usage page" */
  it("stays on the usage route when a date-range preset is clicked", async () => {
    const user = userEvent.setup();
    renderUsagePage("/gateway/usage?vk=vk_canary&days=mtd");

    await user.click(screen.getByRole("button", { name: "Last 7 days" }));

    expect(screen.getByTestId("probe-pathname")).toHaveTextContent("/gateway/usage");
    const search = new URLSearchParams(
      screen.getByTestId("probe-search").textContent ?? "",
    );
    expect(search.get("days")).toBe("7");
    expect(search.get("vk")).toBe("vk_canary");
  });

  /** @scenario "Changing the window or clearing the key filter keeps the browser on the usage page" */
  it("stays on the usage route when the key filter chip is dismissed", async () => {
    const user = userEvent.setup();
    renderUsagePage("/gateway/usage?vk=vk_canary&days=30");

    expect(screen.getByTestId("usage-key-filter")).toHaveTextContent(
      "Canary Gateway Healthcheck",
    );
    await user.click(screen.getByRole("button", { name: "Clear key filter" }));

    expect(screen.getByTestId("probe-pathname")).toHaveTextContent("/gateway/usage");
    const search = new URLSearchParams(
      screen.getByTestId("probe-search").textContent ?? "",
    );
    expect(search.get("vk")).toBeNull();
    expect(search.get("days")).toBe("30");
  });
});
