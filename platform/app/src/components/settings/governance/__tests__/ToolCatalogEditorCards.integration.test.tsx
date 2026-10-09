/**
 * @vitest-environment jsdom
 *
 * Covers specs/ai-governance/personal-portal/admin-catalog-editor.feature,
 * "the catalog renders cards with only the fields a tile has": the tile
 * editor lays each section out as a card grid, and a card shows what the
 * entry stores — name, icon, type, scope, the CLI path policy or the link —
 * and nothing invented. The real editor renders here; only the tRPC
 * boundary is mocked.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

const entriesFixture = [
  {
    id: "entry-claude",
    organizationId: "org-1",
    slug: "claude-code",
    type: "coding_assistant",
    displayName: "Claude Code",
    iconAsset: "preset:claude_code",
    enabled: true,
    order: 0,
    scope: "organization",
    scopeId: "org-1",
    departmentIds: [],
    config: { setupCommand: "claude", allowVk: true, allowOtelDirect: false },
    archivedAt: null,
  },
  {
    id: "entry-anthropic",
    organizationId: "org-1",
    slug: "anthropic",
    type: "model_provider",
    displayName: "Anthropic",
    iconKey: "anthropic",
    enabled: false,
    order: 0,
    scope: "organization",
    scopeId: "org-1",
    departmentIds: ["dept-eng"],
    config: { providerKey: "anthropic" },
    archivedAt: null,
  },
  {
    id: "entry-wiki",
    organizationId: "org-1",
    slug: "wiki",
    type: "external_tool",
    displayName: "Wiki",
    enabled: true,
    order: 0,
    scope: "organization",
    scopeId: "org-1",
    departmentIds: [],
    config: {
      descriptionMarkdown: "Where the docs live",
      linkUrl: "https://wiki.example.test",
    },
    archivedAt: null,
  },
];

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      aiTools: {
        adminList: { invalidate: vi.fn(), setData: vi.fn() },
        list: { invalidate: vi.fn() },
      },
    }),
    aiTools: {
      adminList: {
        useQuery: () => ({ data: entriesFixture, isLoading: false }),
      },
      starterPackCatalog: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      setEnabled: { useMutation: () => ({ mutate: vi.fn() }) },
      remove: { useMutation: () => ({ mutate: vi.fn() }) },
      reorder: { useMutation: () => ({ mutate: vi.fn() }) },
      importStarterPack: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    departments: {
      list: {
        useQuery: () => ({
          data: [{ id: "dept-eng", name: "Engineering" }],
          isLoading: false,
        }),
      },
    },
  },
}));

import { cliPathsLine, ToolCatalogEditor } from "../ToolCatalogEditor";

function renderEditor() {
  const onEditTile = vi.fn();
  render(
    <ChakraProvider value={defaultSystem}>
      <ToolCatalogEditor
        organizationId="org-1"
        onAddTile={vi.fn()}
        onEditTile={onEditTile}
      />
    </ChakraProvider>,
  );
  return { onEditTile };
}

afterEach(() => cleanup());

describe("<ToolCatalogEditor /> cards", () => {
  describe("when the catalog has a tile in every section", () => {
    /** @scenario "the catalog renders cards with only the fields a tile has" */
    it("lays each tile out as a card carrying its real fields", () => {
      renderEditor();

      const claude = screen.getByTestId("catalog-card-entry-claude");
      expect(within(claude).getByText("Claude Code")).toBeVisible();
      expect(within(claude).getByText("Coding assistant")).toBeVisible();
      expect(within(claude).getByText("CLI paths: gateway only")).toBeVisible();
      expect(within(claude).getByLabelText("Drag to reorder")).toBeVisible();

      const anthropic = screen.getByTestId("catalog-card-entry-anthropic");
      expect(within(anthropic).getByText("Model provider")).toBeVisible();
      expect(within(anthropic).getByText("Disabled")).toBeVisible();
      expect(within(anthropic).getByText("Engineering")).toBeVisible();
      expect(
        within(anthropic).queryByText(/CLI paths/),
      ).not.toBeInTheDocument();

      const wiki = screen.getByTestId("catalog-card-entry-wiki");
      expect(within(wiki).getByText("Internal tool")).toBeVisible();
      expect(within(wiki).getByText("https://wiki.example.test")).toBeVisible();
    });

    /** @scenario "the catalog renders cards with only the fields a tile has" */
    it("invents no metric the tile does not store", () => {
      renderEditor();

      expect(screen.queryByText(/seats?/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/licen[cs]e/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
    });
  });

  describe("when the admin opens a card's actions", () => {
    /** @scenario "each card has drag handle, scope badge, and an actions menu" */
    it("offers Edit, Disable and Delete from one overflow menu", async () => {
      const user = userEvent.setup();
      const { onEditTile } = renderEditor();

      await user.click(
        screen.getByRole("button", { name: "Actions for Claude Code" }),
      );
      expect(
        await screen.findByRole("menuitem", { name: /Disable/ }),
      ).toBeVisible();
      expect(screen.getByRole("menuitem", { name: /Delete/ })).toBeVisible();
      await user.click(screen.getByRole("menuitem", { name: /Edit/ }));
      expect(onEditTile).toHaveBeenCalledWith(
        expect.objectContaining({ id: "entry-claude" }),
      );
    });
  });

  describe("cliPathsLine", () => {
    /** @scenario "the catalog renders cards with only the fields a tile has" */
    it("reads both paths as allowed when the config does not say", () => {
      const base = entriesFixture[0]!;
      expect(
        cliPathsLine({ ...base, config: { setupCommand: "x" } } as never),
      ).toBe("CLI paths: gateway · direct");
      expect(
        cliPathsLine({
          ...base,
          config: { setupCommand: "x", allowVk: false },
        } as never),
      ).toBe("CLI paths: direct only");
      expect(
        cliPathsLine({
          ...base,
          config: { setupCommand: "x", allowVk: false, allowOtelDirect: false },
        } as never),
      ).toBe("CLI paths: none");
      expect(
        cliPathsLine({ ...base, type: "model_provider" } as never),
      ).toBeNull();
    });
  });
});
