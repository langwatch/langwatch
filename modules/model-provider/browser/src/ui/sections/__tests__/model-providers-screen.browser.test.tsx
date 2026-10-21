/**
 * Real-Chromium layout, which jsdom cannot do: the providers table spans the page column and
 * lines up with Default models. Spec: specs/model-providers/provider-list.feature
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { renderWithModelProviderHost } from "../../../testing.tsx";

const DEFAULT_MODELS = {
  projectId: "proj-1",
  teamId: "team-1",
  organizationId: "org-1",
  organizationName: "Acme",
  effective: {
    DEFAULT: { model: "openai/gpt-5.5", source: "role_default", scope: "organization" },
  },
  configs: [
    {
      id: "cfg_acme_org",
      config: { DEFAULT: "openai/gpt-5.5" },
      createdAt: new Date("2026-05-15T12:00:00Z"),
      updatedAt: new Date("2026-05-15T12:00:00Z"),
      authorId: "user-1",
      scopes: [{ type: "ORGANIZATION", id: "org-1", name: "Acme" }],
    },
  ],
  available: {
    organization: { id: "org-1", name: "Acme" },
    teams: [{ id: "team-1", name: "Platform" }],
    projects: [{ id: "proj-1", name: "Acme App", teamId: "team-1" }],
  },
  features: [],
};

vi.mock("../../../behavior/model-provider-api.ts", () => ({
  modelProviderApi: {
    useUtils: () => ({ modelProvider: { invalidate: vi.fn() } }),
    modelProvider: {
      delete: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      testConnection: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      getDefaultModelsForProject: {
        useQuery: () => ({ data: DEFAULT_MODELS, isLoading: false }),
      },
      getResolvedDefault: { useQuery: () => ({ data: void 0, isLoading: false }) },
      codexApplyCodingDefaults: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      deleteDefaultModelsConfig: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
  },
}));

vi.mock("../../../behavior/use-all-model-providers-list.ts", () => ({
  useAllModelProvidersList: () => ({
    providers: [
      {
        id: "mp-1",
        provider: "openai",
        name: "OpenAI",
        enabled: true,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
      },
    ],
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

const { default: ModelProvidersScreen } = await import("../model-providers-screen.tsx");

beforeEach(async () => {
  await page.viewport(1280, 800);
  renderWithModelProviderHost(<ModelProvidersScreen />);
});

afterEach(() => cleanup());

describe("given the Model Providers screen in a real browser", () => {
  describe("when providers and default models are listed", () => {
    /** @scenario The providers table spans the page column */
    it("draws the providers table as wide as the page column, flush with Default models", async () => {
      await screen.findByText("OpenAI");
      // Each table's card is its named scroll region.
      const providers = screen.getByRole("region", { name: "Model providers" });
      const defaults = await screen.findByRole("region", { name: "Default models by scope" });
      const column = providers.parentElement!.getBoundingClientRect();
      const providersBox = providers.getBoundingClientRect();
      const defaultsBox = defaults.getBoundingClientRect();

      expect(providersBox.width).toBe(column.width);
      expect(providersBox.right).toBe(defaultsBox.right);
    });
  });
});
