/**
 * @vitest-environment jsdom
 * The virtual keys list on the design-system table: one native action per row, a spend cell that
 * never opens the row, and a status filter that shows counts and its own empty answer.
 * Spec: specs/ai-gateway/virtual-keys.feature
 */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../testing.tsx";

vi.mock("../ui/sections/gateway-layout.tsx", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../features/virtual-keys/ui/sections/virtual-key-create-drawer.tsx", () => ({
  VirtualKeyCreateDrawer: () => null,
}));
vi.mock("../features/virtual-keys/ui/sections/virtual-key-edit-drawer.tsx", () => ({
  VirtualKeyEditDrawer: () => null,
}));
vi.mock("../features/virtual-keys/ui/sections/virtual-key-secret-reveal.tsx", () => ({
  VirtualKeySecretReveal: () => null,
}));

const PROJECT_ID = "project-web-app";

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

const keys = vi.hoisted((): { rows: unknown[] } => ({ rows: [] }));

vi.mock("../behavior/gateway-api.ts", () => ({
  api: {
    useUtils: () => ({ virtualKeys: { list: { invalidate: vi.fn() } } }),
    virtualKeys: {
      list: {
        useQuery: () => ({
          data: keys.rows,
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      spendThisMonth: {
        useQuery: () => ({ data: [], isLoading: false, isError: false, error: null }),
      },
      rotate: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      revoke: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    routingPolicy: { list: { useQuery: () => ({ data: [], isLoading: false }) } },
  },
}));

import VirtualKeysPage from "../ui/sections/gateway/gateway-virtual-keys.screen.tsx";

function renderPage() {
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
  renderWithGatewayHost(<VirtualKeysPage />, { host });
  return host;
}

describe("the virtual keys list", () => {
  afterEach(() => cleanup());

  describe("given two live keys", () => {
    beforeEach(() => {
      keys.rows = [key({ id: "vk-a", name: "alpha" }), key({ id: "vk-b", name: "beta" })];
    });

    it("opens a key once when its name is chosen with the keyboard", async () => {
      const host = renderPage();
      const user = userEvent.setup();

      screen.getByRole("link", { name: "alpha" }).focus();
      await user.keyboard("{Enter}");

      expect(host.recording.navigations).toEqual(["/gateway/virtual-keys/vk-a"]);
    });

    it("opens a key once when its row surface is clicked", async () => {
      const host = renderPage();
      const row = screen.getByTestId("vk-status-vk-b").closest("tr");
      if (!row) throw new Error("the key has no table row");

      await userEvent.click(within(row).getByText("vk-lw-abc…"));

      expect(host.recording.navigations).toEqual(["/gateway/virtual-keys/vk-b"]);
    });

    it("leaves the key unopened when the spend cell is used", async () => {
      const host = renderPage();

      await userEvent.click(screen.getByTestId("vk-spend-vk-a"));

      expect(host.recording.navigations).toEqual(["/gateway/usage?vk=vk-a&days=mtd"]);
    });

    it("names the scrolling table region and its actions column", () => {
      renderPage();

      expect(screen.getByRole("region", { name: "Virtual keys table" })).toHaveAttribute(
        "tabindex",
        "0",
      );
      expect(screen.getAllByRole("button", { name: /^Actions for / })).toHaveLength(2);
    });
  });

  describe("given a live and a revoked key", () => {
    beforeEach(() => {
      keys.rows = [key({ id: "vk-live", name: "live" }), key({ id: "vk-gone", status: "revoked" })];
    });

    it("filters by status with counted chips and says so when a status has no keys", async () => {
      renderPage();

      const active = screen.getByRole("button", { name: "Active, 1 key" });
      expect(active).toHaveAttribute("aria-pressed", "true");
      expect(screen.queryByTestId("vk-status-vk-gone")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Revoked, 1 key" }));

      await waitFor(() => expect(screen.getByTestId("vk-status-vk-gone")).toBeInTheDocument());
      expect(screen.queryByTestId("vk-status-vk-live")).not.toBeInTheDocument();
    });
  });

  describe("given only live keys", () => {
    beforeEach(() => {
      keys.rows = [key({ id: "vk-live", name: "live" })];
    });

    it("answers the Revoked chip with a status-specific empty state", async () => {
      renderPage();

      await userEvent.click(screen.getByRole("button", { name: "Revoked, 0 keys" }));

      expect(await screen.findByText("No revoked keys.")).toBeInTheDocument();
    });
  });
});
