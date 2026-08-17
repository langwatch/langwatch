/**
 * @vitest-environment jsdom
 *
 * The Usage page's "View all traces" button: offered only while one key is
 * in focus and its traces can actually be opened, and carrying the period
 * the reader is looking at rather than a default one.
 *
 * Spec: specs/ai-gateway/virtual-keys.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const PROJECT_ID = "project-web-app";
const VK_ID = "vk_canary";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: {
      id: "org-1",
      slug: "acme",
      teams: [
        {
          id: "team-1",
          projects: [{ id: PROJECT_ID, slug: "web-app" }],
        },
      ],
    },
    project: undefined,
  }),
}));

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

vi.mock("~/utils/api", () => ({
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

import { MemoryRouter } from "react-router";

import GatewayUsagePage from "../usage";

function renderUsagePage(initialUrl: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <GatewayUsagePage />
      </MemoryRouter>
    </ChakraProvider>,
  );
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
        renderUsagePage(`/settings/gateway/usage?vk=${VK_ID}&days=${days}`);
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
        renderUsagePage(`/settings/gateway/usage?vk=${VK_ID}&days=${days}`);
        const params = fragmentParams(hrefOfButton());
        expect(params.get("preset")).toBeNull();
        expect(Number(params.get("from"))).toBeGreaterThan(0);
        expect(Number(params.get("to"))).toBeGreaterThan(
          Number(params.get("from")),
        );
        cleanup();
      }
    });
  });

  describe("when no key is in focus", () => {
    it("offers nothing, since the organization has no single destination", () => {
      renderUsagePage("/settings/gateway/usage?days=30");
      expect(
        screen.queryByTestId("usage-view-all-traces"),
      ).not.toBeInTheDocument();
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
      renderUsagePage(`/settings/gateway/usage?vk=${VK_ID}&days=30`);
      expect(
        screen.queryByTestId("usage-view-all-traces"),
      ).not.toBeInTheDocument();
    });
  });
});
