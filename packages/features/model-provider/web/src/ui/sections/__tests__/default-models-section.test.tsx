/**
 * @vitest-environment jsdom
 *
 * The Default Models table: one row per policy the caller can see, scope chips
 * on the left, the role-level model in its matching column, and indented
 * per-feature overrides under their role.
 *
 * Moved from
 * `platform/app/src/components/settings/__tests__/DefaultModelsSection.integration.test.tsx`.
 * The assertions travelled unchanged; what changed is where the two writes land:
 * "+ Add config" and Edit used to be asserted as `openDrawer` calls, and are now
 * asserted as the host being asked for the same drawer with the same parameter —
 * `defaultModelOverride` is still `platform/app`'s and the screen only addresses
 * it.
 *
 * Spec: specs/model-providers/role-based-default-models.feature
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing";
import { DefaultModelsSection } from "../default-models-section";
import "@testing-library/jest-dom/vitest";

const mockGetDefaultModels = vi.fn();
const mockInvalidate = vi.fn();
const mockDelete = vi.fn();

vi.mock("../../../behavior/model-provider-api", () => ({
  modelProviderApi: {
    useUtils: () => ({ modelProvider: { invalidate: mockInvalidate } }),
    modelProvider: {
      getDefaultModelsForProject: { useQuery: () => mockGetDefaultModels() },
      deleteDefaultModelsConfig: {
        useMutation: () => ({ mutateAsync: mockDelete, isPending: false }),
      },
    },
  },
}));

const FAKE_PAYLOAD = {
  projectId: "proj-1",
  teamId: "team-1",
  organizationId: "org-1",
  organizationName: "Acme",
  effective: {
    DEFAULT: { model: "openai/gpt-5.5", source: "role_default", scope: "organization" },
    FAST: { model: "openai/gpt-5.4-mini", source: "role_default", scope: "organization" },
    EMBEDDINGS: {
      model: "openai/text-embedding-3-small",
      source: "role_default",
      scope: "organization",
    },
  },
  configs: [
    {
      id: "cfg_acme_org",
      config: {
        DEFAULT: "openai/gpt-5.5",
        FAST: "openai/gpt-5.4-mini",
        EMBEDDINGS: "openai/text-embedding-3-small",
      },
      createdAt: new Date("2026-05-15T12:00:00Z"),
      updatedAt: new Date("2026-05-15T12:00:00Z"),
      authorId: "user-1",
      scopes: [{ type: "ORGANIZATION", id: "org-1", name: "Acme" }],
    },
    {
      id: "cfg_ai_search_override",
      config: { "traces.ai_search": "anthropic/claude-sonnet-4-6" },
      createdAt: new Date("2026-05-16T08:00:00Z"),
      updatedAt: new Date("2026-05-16T08:00:00Z"),
      authorId: "user-1",
      scopes: [{ type: "PROJECT", id: "proj-1", name: "Acme App" }],
    },
  ],
  available: {
    organization: { id: "org-1", name: "Acme" },
    teams: [{ id: "team-1", name: "Platform" }],
    projects: [{ id: "proj-1", name: "Acme App", teamId: "team-1" }],
  },
  features: [
    {
      key: "prompt.create_default",
      role: "DEFAULT",
      displayName: "New prompt model",
      description: "Model written into a freshly created prompt.",
    },
    {
      key: "traces.ai_search",
      role: "FAST",
      displayName: "AI search",
      description: "Natural-language search over your traces.",
    },
  ],
};

const HIERARCHY = {
  organization: { id: "org-1" },
  teams: [{ id: "team-1" }],
  projects: [{ id: "proj-1", teamId: "team-1" }],
};

// #5759: a custom model's configured Display Name must reach the table chip too,
// not just the drawer's dropdown — this pins the section → ModelChip
// prop-threading hop. Deliberately disjoint from its own raw id (never
// "gpt-5.1-custom") so a dropped `displayNames` is provable by exact string
// identity rather than a substring match the raw id could still slip through.
const CUSTOM_MODEL_ID = "gpt-5.1";
const CUSTOM_DISPLAY_NAME = "Ada Prod Model";
const CUSTOM_FULL_ID = `custom/${CUSTOM_MODEL_ID}`;

const CUSTOM_MODEL_CONFIG_ROW = {
  id: "cfg_custom_display_name",
  config: { DEFAULT: CUSTOM_FULL_ID },
  createdAt: new Date("2026-05-15T12:00:00Z"),
  updatedAt: new Date("2026-05-15T12:00:00Z"),
  authorId: "user-1",
  scopes: [{ type: "PROJECT", id: "proj-1", name: "Acme App" }],
};

function renderSection({
  displayNames = {},
  host = new FakeModelProviderHost(),
}: { displayNames?: Record<string, string>; host?: FakeModelProviderHost } = {}) {
  return renderWithModelProviderHost(
    <DefaultModelsSection
      filter={{ kind: "all" }}
      enabledProviderKeys={null}
      noProvidersConfigured={false}
      hierarchy={HIERARCHY}
      displayNames={displayNames}
    />,
    host,
  );
}

describe("given the Default Models table", () => {
  beforeEach(() => {
    mockGetDefaultModels.mockReturnValue({ data: FAKE_PAYLOAD, isLoading: false });
    mockInvalidate.mockReset();
    mockDelete.mockReset();
  });
  afterEach(() => cleanup());

  /** @scenario The Default Models page shows the list of override rules */
  it("renders one row per config in the All-you-can-see view", () => {
    renderSection();
    expect(screen.getByTestId("config-row-cfg_acme_org")).toBeInTheDocument();
    expect(screen.getByTestId("config-row-cfg_ai_search_override")).toBeInTheDocument();
  });

  /** @scenario A freshly onboarded org shows its three seeded org-scope rules */
  it("places role-level models in their matching column", () => {
    renderSection();
    const orgRow = screen.getByTestId("config-row-cfg_acme_org");
    expect(screen.getByTestId("config-row-cfg_acme_org-cell-default").textContent).toMatch(
      /gpt-5\.5/,
    );
    expect(screen.getByTestId("config-row-cfg_acme_org-cell-fast").textContent).toMatch(
      /gpt-5\.4-mini/,
    );
    expect(screen.getByTestId("config-row-cfg_acme_org-cell-embeddings").textContent).toMatch(
      /text-embedding-3-small/,
    );
    // The scope chip carries the organization name, not the bare type.
    expect(orgRow.textContent).toMatch(/Acme/);
  });

  describe("when Edit is picked from a row menu", () => {
    /** @scenario Editing an assignment row opens the drawer pre-filled with that rule */
    it("addresses the override drawer with the row's id", async () => {
      const { host } = renderSection();
      fireEvent.click(screen.getByTestId("config-row-cfg_acme_org-actions"));
      fireEvent.click(await screen.findByTestId("config-row-cfg_acme_org-edit"));

      expect(host.drawerOpens).toEqual([
        { drawer: "defaultModelOverride", params: { editingId: "cfg_acme_org" } },
      ]);
    });
  });

  describe("when Delete is picked from a row menu", () => {
    /** @scenario Deleting a config via the row menu removes the row */
    it("fires the delete mutation for that row", async () => {
      renderSection();
      fireEvent.click(screen.getByTestId("config-row-cfg_acme_org-actions"));
      fireEvent.click(await screen.findByTestId("config-row-cfg_acme_org-delete"));

      expect(mockDelete).toHaveBeenCalledWith({ id: "cfg_acme_org" });
    });

    it("refreshes every default-model cache so unmoved surfaces see the removal", async () => {
      const { host } = renderSection();
      fireEvent.click(screen.getByTestId("config-row-cfg_acme_org-actions"));
      fireEvent.click(await screen.findByTestId("config-row-cfg_acme_org-delete"));

      await vi.waitFor(() => {
        expect(mockInvalidate).toHaveBeenCalled();
        expect(host.successes).toEqual([{ title: "Config deleted" }]);
      });
    });

    it("hands a refusal to the host rather than composing its own sentence", async () => {
      const refusal = { data: { error: { code: "insufficient_permissions" } } };
      mockDelete.mockRejectedValueOnce(refusal);
      const { host } = renderSection();
      fireEvent.click(screen.getByTestId("config-row-cfg_acme_org-actions"));
      fireEvent.click(await screen.findByTestId("config-row-cfg_acme_org-delete"));

      await vi.waitFor(() => {
        expect(host.failures).toEqual([
          { error: refusal, fallbackTitle: "Couldn't remove the default model" },
        ]);
      });
    });
  });

  describe("when + Add config is clicked", () => {
    /** @scenario Adding an override opens a drawer with a scope chip picker and per-role model selectors */
    it("addresses the override drawer with no row, so it opens in create mode", () => {
      const { host } = renderSection();
      fireEvent.click(screen.getByTestId("add-config-button"));

      expect(host.drawerOpens).toEqual([{ drawer: "defaultModelOverride", params: {} }]);
    });
  });

  describe("given a config whose role model is a renamed custom model", () => {
    describe("when the section receives the resolved displayNames map", () => {
      it("renders the table chip with the configured display name, not the raw model id", () => {
        mockGetDefaultModels.mockReturnValue({
          data: { ...FAKE_PAYLOAD, configs: [CUSTOM_MODEL_CONFIG_ROW] },
          isLoading: false,
        });

        renderSection({ displayNames: { [CUSTOM_FULL_ID]: CUSTOM_DISPLAY_NAME } });

        expect(screen.getByTestId(`model-chip-${CUSTOM_FULL_ID}`).textContent).toBe(
          CUSTOM_DISPLAY_NAME,
        );
      });
    });
  });
});
