/**
 * @vitest-environment jsdom
 *
 * The Usage page's "View all traces" button: offered only while one key is
 * in focus and its traces can actually be opened, and carrying the period
 * the reader is looking at rather than a default one.
 *
 * Spec: specs/ai-gateway/virtual-keys.feature
 */
import { cleanup, screen } from "@testing-library/react";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ui/sections/gateway-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const PROJECT_ID = "project-web-app";
const VK_ID = "vk_canary";

// The button sits above Top models, so the page has to have usage to show.
const summary = {
  totalUsd: "1.500000",
  totalRequests: 12,
  blockedRequests: 0,
  avgUsdPerRequest: "0.125000",
  byVirtualKey: [],
  byModel: [{ model: "gpt-5-mini", totalUsd: "1.500000", requests: 12 }],
  byDay: [{ day: "2026-03-10", totalUsd: "1.500000", requests: 12 }],
};

const { keyRow } = vi.hoisted(() => ({
  keyRow: {
    current: {
      name: "Canary Gateway Healthcheck",
      traceProjectId: "project-web-app",
      traceProjectArchived: false,
    } as Record<string, unknown>,
  },
}));

vi.mock("../../../behavior/gateway-api", () => ({
  api: {
    gatewayUsage: {
      summary: {
        useQuery: () => ({
          data: summary,
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      summaryForVirtualKey: {
        useQuery: () => ({
          data: { ...summary, recentDebits: [] },
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
    virtualKeys: {
      get: {
        useQuery: () => ({ data: keyRow.current, isLoading: false }),
      },
    },
  },
}));

import GatewayUsagePage from "../gateway-usage.screen";

/**
 * An organization with one team holding the project a key's traces land in.
 * The usage page is organization-wide, so no project is in scope.
 */
const ORGANIZATION = {
  id: "org-1",
  name: "ACME",
  slug: "acme",
  teams: [
    {
      id: "team-1",
      name: "platform",
      projects: [{ id: PROJECT_ID, name: "web-app", slug: "web-app", teamId: "team-1" }],
    },
  ],
};

/**
 * The page, opened at one address.
 *
 * The screen reads its filters out of the host's route reading rather than out
 * of a router, so the address a case opens on is a host option and the
 * `MemoryRouter` these cases needed goes with the compat layer.
 */
function renderUsagePage(initialUrl: string) {
  const host = fakeGatewayHost({
    permissions: ["gatewayUsage:view"],
    organization: ORGANIZATION,
    project: null,
    query: Object.fromEntries(new URLSearchParams(initialUrl.slice(initialUrl.indexOf("?") + 1))),
  });
  return renderWithGatewayHost(<GatewayUsagePage />, { host });
}

function hrefOfButton(): string {
  const href = screen
    .getByTestId("usage-view-all-traces")
    .closest("a")
    ?.getAttribute("href");
  if (!href) throw new Error("the traces button carries no link");
  return href;
}

function fragmentParams(href: string): URLSearchParams {
  return new URLSearchParams(href.slice(href.indexOf("?") + 1));
}

describe("Usage page view-all-traces button", () => {
  beforeEach(() => {
    Object.defineProperty(window, "scrollTo", {
      value: vi.fn(),
      writable: true,
    });
    keyRow.current = {
      name: "Canary Gateway Healthcheck",
      traceProjectId: PROJECT_ID,
      traceProjectArchived: false,
    };
  });
  afterEach(() => cleanup());

  describe("when the page is filtered to one key", () => {
    /** @scenario "The traces link carries the window the reader is looking at" */
    it("opens the key's own project on the preset for that period", () => {
      for (const [days, preset] of [
        ["1", "24h"],
        ["7", "7d"],
        ["30", "30d"],
      ] as const) {
        renderUsagePage(`/gateway/usage?vk=${VK_ID}&days=${days}`);
        const href = hrefOfButton();
        expect(href.startsWith("/web-app/traces#all-traces?")).toBe(true);
        const params = fragmentParams(href);
        expect(params.get("preset")).toBe(preset);
        expect(params.get("q")).toContain(VK_ID);
        cleanup();
      }
    });

    /** @scenario "Periods the Trace Explorer has no preset for travel as exact bounds" */
    it("sends exact instants for the periods with no preset to name", () => {
      for (const days of ["90", "mtd"]) {
        renderUsagePage(`/gateway/usage?vk=${VK_ID}&days=${days}`);
        const params = fragmentParams(hrefOfButton());
        expect(params.get("preset")).toBeNull();
        expect(Number(params.get("from"))).toBeGreaterThan(0);
        expect(Number(params.get("to"))).toBeGreaterThan(Number(params.get("from")));
        cleanup();
      }
    });
  });

  describe("when no key is in focus", () => {
    it("offers nothing, since the organization has no single destination", () => {
      renderUsagePage("/gateway/usage?days=30");
      expect(screen.queryByTestId("usage-view-all-traces")).not.toBeInTheDocument();
    });
  });

  describe("when the key has nowhere to send its traces", () => {
    /** @scenario "A key with nowhere to send its traces offers no trace links" */
    it("offers nothing rather than a link that would bounce", () => {
      keyRow.current = {
        name: "Legacy key",
        traceProjectId: null,
        traceProjectArchived: false,
      };
      renderUsagePage(`/gateway/usage?vk=${VK_ID}&days=30`);
      expect(screen.queryByTestId("usage-view-all-traces")).not.toBeInTheDocument();
    });
  });
});
