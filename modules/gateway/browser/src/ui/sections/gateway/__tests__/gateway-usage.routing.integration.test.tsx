/**
 * @vitest-environment jsdom
 * Tests that query changes (date ranges, key filters) don't move the path or navigate.
 */
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../../testing.tsx";

vi.mock("../../../../ui/sections/gateway-layout.tsx", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
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

vi.mock("../../../../behavior/gateway-api.ts", () => ({
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

/** An organization with no project in scope: the usage page is organization-wide. */
function hostAt(url: string) {
  return fakeGatewayHost({
    permissions: ["gatewayUsage:view"],
    organization: { id: "org-1", name: "ACME", slug: "acme", teams: [] },
    project: null,
    query: Object.fromEntries(new URLSearchParams(url.slice(url.indexOf("?") + 1))),
  });
}

import GatewayUsagePage from "../gateway-usage.screen.tsx";

function renderUsagePage(initialUrl: string) {
  const host = hostAt(initialUrl);
  renderWithGatewayHost(<GatewayUsagePage />, { host });
  return host;
}

/** The query the page last asked for, as a reader would read the address bar. */
function lastQuery(host: ReturnType<typeof hostAt>): URLSearchParams {
  const write = host.recording.queries.at(-1);
  if (!write) throw new Error("the page wrote no query");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(write.next)) {
    if (value !== void 0) params.set(key, value);
  }
  return params;
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
    const host = renderUsagePage("/gateway/usage?vk=vk_canary&days=mtd");

    await user.click(screen.getByRole("button", { name: "Last 7 days" }));

    expect(host.recording.navigations).toEqual([]);
    const search = lastQuery(host);
    expect(search.get("days")).toBe("7");
    expect(search.get("vk")).toBe("vk_canary");
  });

  /** @scenario "Changing the window or clearing the key filter keeps the browser on the usage page" */
  it("stays on the usage route when the key filter chip is dismissed", async () => {
    const user = userEvent.setup();
    const host = renderUsagePage("/gateway/usage?vk=vk_canary&days=30");

    expect(screen.getByTestId("usage-key-filter")).toHaveTextContent("Canary Gateway Healthcheck");
    await user.click(screen.getByRole("button", { name: "Clear key filter" }));

    expect(host.recording.navigations).toEqual([]);
    const search = lastQuery(host);
    expect(search.get("vk")).toBeNull();
    expect(search.get("days")).toBe("30");
  });
});
