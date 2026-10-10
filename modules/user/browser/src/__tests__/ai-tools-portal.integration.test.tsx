/**
 * @vitest-environment jsdom
 */
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: vi.fn(() => null),
}));

// Zero enabled entries: list resolves to [], availability to no configured
// providers. Server-side auto-provisioning means a fresh org never actually
// serves an empty list; this state is only reachable when the catalog was
// curated down to no enabled tools (the curated-empty fallback these pin).
vi.mock("../behavior/personal-workspace-api.ts", () => ({
  api: {
    aiTools: {
      list: { useQuery: () => ({ data: [], isLoading: false }) },
      providerAvailability: {
        useQuery: () => ({ data: { configuredProviders: [] } }),
      },
    },
  },
}));

import { MeshGradient } from "@paper-design/shaders-react";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../testing.tsx";
import { AiToolsPortal } from "../ui/sections/ai-tools-portal.tsx";

// The portal's permission gate is the only host input the empty-state branches
// read; flip it per test via this mutable flag.
let mockCanManage = false;

function renderWithProviders(ui: React.ReactElement) {
  return renderWithPersonalWorkspaceHost(ui, {
    host: fakePersonalWorkspaceHost({
      permissions: mockCanManage ? ["aiTools:manage"] : [],
    }),
  });
}

describe("<AiToolsPortal /> curated-empty fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom does not apply Chakra's layered stylesheet to computed styles.
    for (const [token, colour] of Object.entries({
      "yellow-solid": "#c09020",
      "orange-solid": "#e08020",
      "purple-solid": "#8050c0",
      "bg-card": "#ffffff",
    }))
      document.body.style.setProperty(`--chakra-colors-${token}`, colour);
  });

  afterEach(() => {
    cleanup();
    for (const token of ["yellow-solid", "orange-solid", "purple-solid", "bg-card"])
      document.body.style.removeProperty(`--chakra-colors-${token}`);
    document.documentElement.classList.remove("dark");
  });

  describe("when the catalog query returns no enabled tools and the viewer can manage the catalog", () => {
    beforeEach(() => {
      mockCanManage = true;
    });

    /** @scenario curated-empty catalog shows the getting-started banner to a catalog admin */
    it("renders the governance getting-started banner linking to the tool catalog", () => {
      renderWithProviders(<AiToolsPortal />);

      expect(
        screen.getByRole("heading", {
          name: "Getting started with LangWatch AI Governance",
        }),
      ).toBeInTheDocument();

      const cta = screen.getByRole("link", { name: /add your first tools/i });
      expect(cta).toHaveAttribute("href", "/governance/inventory?tab=catalog");
    });

    it("refreshes the canvas colours when the theme changes", async () => {
      renderWithProviders(<AiToolsPortal />);
      expect(vi.mocked(MeshGradient).mock.lastCall?.[0].colors).toEqual([
        "#c09020",
        "#e08020",
        "#8050c0",
        "#ffffff",
      ]);
      await act(async () => {
        document.body.style.setProperty("--chakra-colors-bg-card", "#202030");
        document.documentElement.classList.add("dark");
      });
      await waitFor(() =>
        expect(vi.mocked(MeshGradient).mock.lastCall?.[0].colors).toEqual([
          "#c09020",
          "#e08020",
          "#8050c0",
          "#202030",
        ]),
      );
    });

    it("does not render any install-the-CLI affordance", () => {
      renderWithProviders(<AiToolsPortal />);
      expect(screen.queryByText(/npm install -g langwatch/i)).toBeNull();
      expect(screen.queryByText(/Install the LangWatch CLI/i)).toBeNull();
    });
  });

  describe("when the catalog query returns no enabled tools and the viewer is a member", () => {
    beforeEach(() => {
      mockCanManage = false;
    });

    /** @scenario curated-empty catalog shows a member empty-state note */
    it("renders the member note and no getting-started banner or CLI card", () => {
      renderWithProviders(<AiToolsPortal />);

      expect(screen.getByRole("heading", { name: "Your AI tools portal" })).toBeInTheDocument();
      expect(screen.getByText(/admin hasn.t added any AI tools/i)).toBeInTheDocument();

      expect(
        screen.queryByRole("heading", {
          name: "Getting started with LangWatch AI Governance",
        }),
      ).toBeNull();
      expect(screen.queryByText(/npm install -g langwatch/i)).toBeNull();
    });
  });
});
