/**
 * @vitest-environment jsdom
 *
 * The page-level scope filter is an ADDRESS, not state.
 *
 * `platform/app` kept a `useState` synced to `?scope=` by an effect, so the
 * filter could disagree with the URL it was mirroring. The screen reads
 * `?scope=` on every render and writes the whole next query through the host,
 * which is the one thing that makes a filtered view shareable and survivable
 * across a reload.
 *
 * Spec: specs/model-providers/scope-filter.feature
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_PROVIDER_SCOPE_QUERY_KEY } from "../model-providers.screen";
import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing";

const { mockState } = vi.hoisted(() => ({
  mockState: { providers: [] as Array<Record<string, unknown>> },
}));

vi.mock("../../../behavior/model-provider-api", () => ({
  modelProviderApi: {
    useUtils: () => ({
      organization: { getAll: { invalidate: vi.fn() } },
      modelProvider: { invalidate: vi.fn() },
    }),
    modelProvider: {
      listAllForOrganizationForFrontend: {
        useQuery: () => ({ data: mockState.providers, isLoading: false, refetch: vi.fn() }),
      },
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
      },
      delete: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      testConnection: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      getDefaultModelsForProject: { useQuery: () => ({ data: void 0, isLoading: true }) },
      // The Codex post-connect ask is mounted at page level (its own drawer
      // closes before the question can be asked), and it reads the resolved
      // Langy default to decide whether the question is already answered. It
      // renders nothing until a sign-in queues one, but the read happens on
      // every render, so leaving this out fails the whole file on a TypeError.
      getResolvedDefault: { useQuery: () => ({ data: void 0, isLoading: false }) },
      codexApplyCodingDefaults: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      deleteDefaultModelsConfig: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
  },
}));

// The picker itself is `@langwatch/authz-web`'s and has its own suite; what
// this file is about is what the SCREEN does with the value it hands back, so
// the menu is replaced by two buttons that call `onChange` directly.
vi.mock("@langwatch/authz-web/surfaces/scope-picker", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/authz-web/surfaces/scope-picker")>(
    "@langwatch/authz-web/surfaces/scope-picker",
  );
  return {
    ...actual,
    ScopeFilter: ({ onChange }: { onChange: (next: unknown) => void }) => (
      <div>
        <button data-testid="filter-all" onClick={() => onChange({ kind: "all" })} />
        <button
          data-testid="filter-team-1"
          onClick={() =>
            onChange({
              kind: "specific",
              scopeType: "TEAM",
              scopeId: "team-1",
              name: "Platform",
            })
          }
        />
      </div>
    ),
  };
});

vi.mock("@langwatch/design-system/page-layout", () => ({
  PageLayout: {
    HeaderButton: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
  },
}));

const { default: ModelProvidersScreen } = await import("../model-providers.screen");

const AVAILABLE = {
  organization: { id: "org-1", name: "ACME" },
  teams: [{ id: "team-1", name: "Platform" }],
  projects: [{ id: "proj-1", name: "Web App", teamId: "team-1" }],
};

const ORG_ROW = {
  id: "mp-org",
  provider: "openai",
  name: "Org OpenAI",
  enabled: true,
  scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
};

const OTHER_TEAM_ROW = {
  id: "mp-other",
  provider: "anthropic",
  name: "Other Team Anthropic",
  enabled: true,
  scopes: [{ scopeType: "TEAM", scopeId: "team-2" }],
};

function hostAt(query: Record<string, string | undefined>) {
  return new FakeModelProviderHost({
    scope: { organizationId: "org-1", teamId: "team-1", projectId: "proj-1", projectSlug: "web-app" },
    availableScopes: AVAILABLE,
    query,
  });
}

describe("given the Model Providers screen's scope filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.providers = [ORG_ROW, OTHER_TEAM_ROW];
  });

  afterEach(() => cleanup());

  describe("when the address carries no scope", () => {
    it("shows every row the reader can see", () => {
      renderWithModelProviderHost(<ModelProvidersScreen />, hostAt({}));

      expect(screen.getByText("Org OpenAI")).toBeTruthy();
      expect(screen.getByText("Other Team Anthropic")).toBeTruthy();
    });
  });

  describe("when the address names a team", () => {
    it("narrows the table to that branch of the org tree, parents included", () => {
      renderWithModelProviderHost(
        <ModelProvidersScreen />,
        hostAt({ [MODEL_PROVIDER_SCOPE_QUERY_KEY]: "TEAM:team-1" }),
      );

      // The organization row is a parent of the picked team and stays; the other
      // team's row is on a different branch and goes.
      expect(screen.getByText("Org OpenAI")).toBeTruthy();
      expect(screen.queryByText("Other Team Anthropic")).toBeNull();
    });
  });

  describe("when the address names a scope the reader can no longer see", () => {
    it("reads as everything rather than rendering an empty table for a stale link", () => {
      renderWithModelProviderHost(
        <ModelProvidersScreen />,
        hostAt({ [MODEL_PROVIDER_SCOPE_QUERY_KEY]: "TEAM:team-deleted" }),
      );

      expect(screen.getByText("Org OpenAI")).toBeTruthy();
      expect(screen.getByText("Other Team Anthropic")).toBeTruthy();
    });
  });

  describe("when the reader picks a scope", () => {
    it("writes it to the address rather than holding it in state", () => {
      const host = hostAt({ existing: "kept" });
      renderWithModelProviderHost(<ModelProvidersScreen />, host);

      fireEvent.click(screen.getByTestId("filter-team-1"));

      expect(host.queryWrites).toEqual([
        { existing: "kept", [MODEL_PROVIDER_SCOPE_QUERY_KEY]: "TEAM:team-1" },
      ]);
    });

    it("clears the key rather than writing an empty one when the pick is everything", () => {
      const host = hostAt({ existing: "kept", [MODEL_PROVIDER_SCOPE_QUERY_KEY]: "TEAM:team-1" });
      renderWithModelProviderHost(<ModelProvidersScreen />, host);

      fireEvent.click(screen.getByTestId("filter-all"));

      expect(host.queryWrites).toEqual([
        { existing: "kept", [MODEL_PROVIDER_SCOPE_QUERY_KEY]: void 0 },
      ]);
    });
  });
});
