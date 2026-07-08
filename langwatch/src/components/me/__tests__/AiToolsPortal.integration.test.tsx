/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

// Starter-pack projection the portal renders as suggested tiles when the
// catalog is empty. Mirrors the aiTools.suggestedTiles wire shape.
const SUGGESTED_TILES = [
  {
    type: "coding_assistant",
    slug: "claude-code",
    displayName: "Claude Code",
    iconAsset: "preset:claude_code",
    config: { assistantKind: "claude_code", setupCommand: "langwatch claude" },
  },
  {
    type: "coding_assistant",
    slug: "codex",
    displayName: "Codex",
    iconAsset: "preset:codex",
    config: { assistantKind: "codex", setupCommand: "langwatch codex" },
  },
  {
    type: "coding_assistant",
    slug: "gemini",
    displayName: "Gemini CLI",
    iconAsset: "preset:gemini",
    config: { assistantKind: "gemini", setupCommand: "langwatch gemini" },
  },
  {
    type: "coding_assistant",
    slug: "opencode",
    displayName: "opencode",
    iconAsset: "preset:opencode",
    config: { assistantKind: "opencode", setupCommand: "langwatch opencode" },
  },
];

// Catalog contents per test; empty by default (fresh org).
let mockCatalogEntries: unknown[] = [];
// Suggestions server response per test; the starter pack by default
// (untouched org). [] simulates a curated catalog the member can't see.
let mockSuggested: { data: unknown[] | undefined; isLoading: boolean } = {
  data: SUGGESTED_TILES,
  isLoading: false,
};

vi.mock("~/utils/api", () => ({
  api: {
    aiTools: {
      list: {
        useQuery: () => ({ data: mockCatalogEntries, isLoading: false }),
      },
      providerAvailability: {
        useQuery: () => ({ data: { configuredProviders: [] } }),
      },
      suggestedTiles: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) =>
          opts?.enabled === false
            ? { data: undefined, isLoading: false }
            : mockSuggested,
      },
    },
    publicEnv: {
      useQuery: () => ({
        data: { IS_SAAS: true, BASE_HOST: "https://app.langwatch.ai" },
      }),
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
    mockCatalogEntries = [];
    mockSuggested = { data: SUGGESTED_TILES, isLoading: false };
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the catalog is empty and the viewer can manage it", () => {
    beforeEach(() => {
      mockCanManage = true;
    });

    /** @scenario brand-new org shows the getting-started banner and suggestions to a catalog admin */
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

    /** @scenario brand-new org shows the getting-started banner and suggestions to a catalog admin */
    it("renders the suggested coding assistants below the banner", () => {
      renderWithProviders(<AiToolsPortal />);

      expect(
        screen.getByRole("heading", { name: /coding assistants/i }),
      ).toBeInTheDocument();
      expect(screen.getByText("Suggested")).toBeInTheDocument();
      expect(screen.getByText("Claude Code")).toBeInTheDocument();
      expect(screen.getByText("Codex")).toBeInTheDocument();
      expect(screen.getByText("Gemini CLI")).toBeInTheDocument();
      expect(screen.getByText("opencode")).toBeInTheDocument();
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

    /** @scenario brand-new org suggests the default coding assistants to a member */
    it("renders the suggested coding assistants with Claude Code first and no banner", () => {
      renderWithProviders(<AiToolsPortal />);

      const tileNames = screen
        .getAllByText(/^(Claude Code|Codex|Gemini CLI|opencode)$/)
        .map((el) => el.textContent);
      expect(tileNames[0]).toBe("Claude Code");
      expect(tileNames).toHaveLength(4);
      expect(screen.getByText("Suggested")).toBeInTheDocument();

      expect(
        screen.queryByRole("heading", {
          name: "Getting started with LangWatch AI Governance",
        }),
      ).toBeNull();
      expect(screen.queryByText(/admin hasn.t added any AI tools/i)).toBeNull();
    });

    /** @scenario brand-new org suggests the default coding assistants to a member */
    it("reveals the setup command when a suggested tile is expanded", () => {
      renderWithProviders(<AiToolsPortal />);

      fireEvent.click(screen.getByText("Claude Code"));

      expect(screen.getByText("langwatch claude")).toBeInTheDocument();
    });

    it("never shows the nothing-here note while suggestions are loading", () => {
      mockSuggested = { data: undefined, isLoading: true };

      renderWithProviders(<AiToolsPortal />);

      expect(screen.queryByText(/admin hasn.t added any AI tools/i)).toBeNull();
      expect(screen.queryByText("Claude Code")).toBeNull();
    });
  });

  describe("when the org has a curated catalog the member cannot see", () => {
    beforeEach(() => {
      mockCanManage = false;
      // Visible slice is empty but the server withholds suggestions
      // because the org's catalog is curated (e.g. department-scoped).
      mockSuggested = { data: [], isLoading: false };
    });

    /** @scenario a curated catalog the member cannot see never falls back to suggestions */
    it("renders the nothing-here note and no suggested tiles", () => {
      renderWithProviders(<AiToolsPortal />);

      expect(
        screen.getByText(/admin hasn.t added any AI tools/i),
      ).toBeInTheDocument();
      expect(screen.queryByText("Claude Code")).toBeNull();
      expect(screen.queryByText("Suggested")).toBeNull();
    });
  });

  describe("when the catalog has published entries", () => {
    beforeEach(() => {
      mockCanManage = false;
      mockCatalogEntries = [
        {
          id: "entry-1",
          scope: "organization",
          scopeId: "org-1",
          type: "coding_assistant",
          displayName: "Codex",
          slug: "codex",
          order: 1,
          enabled: true,
          config: { setupCommand: "langwatch codex" },
        },
      ];
    });

    /** @scenario publishing any catalog entry replaces the suggested tiles */
    it("renders only the published tiles with no suggested marker", () => {
      renderWithProviders(<AiToolsPortal />);

      expect(screen.getByText("Codex")).toBeInTheDocument();
      expect(screen.queryByText("Claude Code")).toBeNull();
      expect(screen.queryByText("Suggested")).toBeNull();
    });
  });
});
