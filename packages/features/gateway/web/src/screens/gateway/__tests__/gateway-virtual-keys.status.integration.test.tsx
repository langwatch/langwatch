/**
 * @vitest-environment jsdom
 *
 * What the status column says, and which keys the Active tab holds.
 *
 * Expiry is a date on an ACTIVE key rather than a status value, so the
 * badge derives it and the stored stops still win. A disabled key used to
 * fall out of both tabs and carry no actions at all, which left the only
 * route to it a link somebody had kept.
 *
 * Spec: specs/ai-gateway/virtual-keys.feature
 */
import { cleanup, screen, waitFor, within } from "@testing-library/react";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ui/sections/gateway-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../../../features/virtual-keys/ui/sections/virtual-key-create-drawer", () => ({
  VirtualKeyCreateDrawer: () => null,
}));
vi.mock("../../../features/virtual-keys/ui/sections/virtual-key-edit-drawer", () => ({
  VirtualKeyEditDrawer: () => null,
}));
vi.mock("../../../features/virtual-keys/ui/sections/virtual-key-secret-reveal", () => ({
  VirtualKeySecretReveal: () => null,
}));

const PROJECT_ID = "project-web-app";

const NOW = new Date("2026-03-10T21:00:00.000Z");

function key(overrides: Record<string, unknown>) {
  return {
    id: "vk-1",
    name: "key",
    description: null,
    displayPrefix: "vk-lw-abc",
    status: "active",
    scopes: [],
    config: {},
    routingMode: "NONE",
    routingPolicyId: null,
    principalUserId: null,
    principalUser: null,
    lastUsedAt: null,
    traceProjectId: PROJECT_ID,
    traceProjectArchived: false,
    expiresAt: null,
    ...overrides,
  };
}

const KEYS = [
  key({ id: "vk-live", name: "live-key" }),
  key({
    id: "vk-future",
    name: "future-key",
    expiresAt: "2026-03-20T00:00:00.000Z",
  }),
  key({
    id: "vk-expired",
    name: "expired-key",
    expiresAt: "2026-03-01T00:00:00.000Z",
  }),
  key({ id: "vk-paused", name: "paused-key", status: "disabled" }),
  key({
    id: "vk-gone",
    name: "revoked-key",
    status: "revoked",
    // A revoked key that also ran out reports the stop that happened, not
    // the one that would have.
    expiresAt: "2026-03-01T00:00:00.000Z",
  }),
];

vi.mock("../../../behavior/gateway-api", () => ({
  api: {
    useUtils: () => ({
      virtualKeys: { list: { invalidate: vi.fn() } },
    }),
    virtualKeys: {
      list: {
        useQuery: () => ({
          data: KEYS,
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      spendThisMonth: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
      rotate: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      revoke: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    routingPolicy: {
      list: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

/** One organization with one team and one project, read by an admin. */
const host = fakeGatewayHost({
  permissions: ["virtualKeys:manage"],
  organization: {
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
  },
});

import VirtualKeysPage from "../gateway-virtual-keys.screen";

function renderPage() {
  return renderWithGatewayHost(<VirtualKeysPage />, { host });
}

describe("virtual keys status column", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  describe("when a key is past its expiration date", () => {
    /** @scenario "A key past its expiration date is badged Expired" */
    it("badges it expired, and leaves a key with time left active", () => {
      renderPage();
      expect(screen.getByTestId("vk-status-vk-expired")).toHaveTextContent("expired");
      expect(screen.getByTestId("vk-status-vk-future")).toHaveTextContent("active");
      expect(screen.getByTestId("vk-status-vk-live")).toHaveTextContent("active");
    });

    /** @scenario "A key past its expiration date is badged Expired" */
    it("reports the stored stop first for a revoked key that also ran out", async () => {
      // Chakra's tabs switch on a real click, which fake timers stall.
      vi.useRealTimers();
      renderPage();

      // The row lives on the Revoked tab, so the badge only proves the
      // precedence once that tab is the one on screen.
      expect(screen.queryByTestId("vk-status-vk-gone")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("tab", { name: /Revoked/ }));

      await waitFor(() =>
        expect(screen.getByTestId("vk-status-vk-gone")).toHaveTextContent("revoked"),
      );
      expect(screen.getByTestId("vk-status-vk-gone")).not.toHaveTextContent("expired");
    });
  });

  describe("when a key is disabled", () => {
    /** @scenario "A disabled key is listed with the active keys and keeps its actions" */
    it("lists it with the live keys, badged disabled", () => {
      renderPage();
      expect(screen.getByTestId("vk-status-vk-paused")).toHaveTextContent("disabled");
      // Four live keys, one revoked: the counts are what the tabs claim.
      expect(screen.getByRole("tab", { name: /Active/ })).toHaveTextContent("4");
      expect(screen.getByRole("tab", { name: /Revoked/ })).toHaveTextContent("1");
    });

    /** @scenario "A disabled key is listed with the active keys and keeps its actions" */
    it("offers Details, View traces and Revoke, but not Edit or Rotate", async () => {
      // Chakra's menu opens on a real click, which fake timers stall.
      vi.useRealTimers();
      renderPage();

      const row = screen.getByTestId("vk-status-vk-paused").closest("tr");
      expect(row).not.toBeNull();
      await userEvent.click(within(row as HTMLElement).getByRole("button", { name: "Actions" }));

      await waitFor(() => expect(screen.getByText("Details")).toBeInTheDocument());
      expect(screen.getByText("View traces")).toBeInTheDocument();
      expect(screen.getByText("Revoke")).toBeInTheDocument();
      expect(screen.queryByText("Edit")).not.toBeInTheDocument();
      expect(screen.queryByText("Rotate secret")).not.toBeInTheDocument();
    });
  });
});
