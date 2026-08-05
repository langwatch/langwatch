/**
 * @vitest-environment jsdom
 *
 * Covers specs/ai-governance/personal-portal/admin-catalog-editor.feature,
 * the ungated starter-pack import: with auto-provisioning, real catalogs
 * are never empty, so the import affordance must stay reachable from a
 * populated catalog. The real editor renders here; only the tRPC boundary
 * is mocked.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const entriesFixture = [
  {
    id: "entry-1",
    organizationId: "org-1",
    slug: "claude-code",
    type: "coding_assistant",
    displayName: "Claude Code",
    subtitle: "Coding assistant",
    iconAsset: "preset:claude-code",
    enabled: true,
    order: 0,
    scope: "organization",
    scopeId: "org-1",
    config: {},
    archivedAt: null,
  },
];

const starterTilesFixture = [
  {
    slug: "claude-code",
    type: "coding_assistant",
    displayName: "Claude Code",
  },
  { slug: "codex", type: "coding_assistant", displayName: "Codex" },
  { slug: "openai", type: "model_provider", displayName: "OpenAI" },
];

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      aiTools: { adminList: { invalidate: vi.fn(), setData: vi.fn() } },
    }),
    aiTools: {
      adminList: {
        useQuery: () => ({
          data: entriesFixture,
          isLoading: false,
        }),
      },
      starterPackCatalog: {
        useQuery: () => ({ data: starterTilesFixture, isLoading: false }),
      },
      setEnabled: { useMutation: () => ({ mutate: vi.fn() }) },
      remove: { useMutation: () => ({ mutate: vi.fn() }) },
      reorder: { useMutation: () => ({ mutate: vi.fn() }) },
      importStarterPack: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    departments: {
      list: { useQuery: () => ({ data: [], isLoading: false }) },
    },
  },
}));

import { ToolCatalogEditor } from "../ToolCatalogEditor";

describe("<ToolCatalogEditor /> starter pack import", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when the catalog already has entries", () => {
    /** @scenario "a populated catalog still offers the starter pack import behind a toggle" */
    it("shows the import button instead of the empty-state callout and reveals the checklist on click", async () => {
      const user = userEvent.setup();
      render(
        <ChakraProvider value={defaultSystem}>
          <ToolCatalogEditor
            organizationId="org-1"
            onAddTile={vi.fn()}
            onEditTile={vi.fn()}
          />
        </ChakraProvider>,
      );

      expect(
        screen.queryByText(/Publish a starter pack to get going/i),
      ).not.toBeInTheDocument();
      const toggle = screen.getByRole("button", {
        name: /import starter pack/i,
      });

      await user.click(toggle);

      expect(
        await screen.findByText(/Adds starter tiles the catalog never had/i),
      ).toBeInTheDocument();
      expect(screen.getByText("Codex")).toBeInTheDocument();
    });
  });
});
