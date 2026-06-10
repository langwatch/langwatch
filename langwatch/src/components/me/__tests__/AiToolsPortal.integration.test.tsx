/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

vi.mock("~/hooks/useReducedMotion", () => ({
  useReducedMotion: vi.fn(() => false),
}));

// The portal's permission gate is the only org-context input the empty-state
// branches read; flip it per test via this mutable flag.
let mockCanManage = false;
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(() => ({
    organization: { id: "org-1" },
    hasPermission: (permission: string) =>
      permission === "aiTools:manage" ? mockCanManage : true,
  })),
}));

// Empty catalog: list resolves to [], availability to no configured providers.
vi.mock("~/utils/api", () => ({
  api: {
    aiTools: {
      list: { useQuery: () => ({ data: [], isLoading: false }) },
      providerAvailability: {
        useQuery: () => ({ data: { configuredProviders: [] } }),
      },
    },
  },
}));

import { AiToolsPortal } from "../AiToolsPortal";

function renderWithProviders(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

describe("<AiToolsPortal /> empty state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the catalog is empty and the viewer can manage it", () => {
    beforeEach(() => {
      mockCanManage = true;
    });

    /** @scenario brand-new org shows the getting-started banner to a catalog admin */
    it("renders the governance getting-started banner linking to the tool catalog", () => {
      renderWithProviders(<AiToolsPortal />);

      expect(
        screen.getByRole("heading", {
          name: "Getting started with LangWatch AI Governance",
        }),
      ).toBeInTheDocument();

      const cta = screen.getByRole("link", { name: /add your first tools/i });
      expect(cta).toHaveAttribute("href", "/settings/governance/tool-catalog");
    });

    it("does not render any install-the-CLI affordance", () => {
      renderWithProviders(<AiToolsPortal />);
      expect(screen.queryByText(/npm install -g langwatch/i)).toBeNull();
      expect(screen.queryByText(/Install the LangWatch CLI/i)).toBeNull();
    });
  });

  describe("when the catalog is empty and the viewer is a member", () => {
    beforeEach(() => {
      mockCanManage = false;
    });

    /** @scenario brand-new org with no catalog shows a member empty-state note */
    it("renders the member note and no getting-started banner or CLI card", () => {
      renderWithProviders(<AiToolsPortal />);

      expect(
        screen.getByRole("heading", { name: "Your AI tools portal" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/admin hasn.t added any AI tools/i),
      ).toBeInTheDocument();

      expect(
        screen.queryByRole("heading", {
          name: "Getting started with LangWatch AI Governance",
        }),
      ).toBeNull();
      expect(screen.queryByText(/npm install -g langwatch/i)).toBeNull();
    });
  });
});
