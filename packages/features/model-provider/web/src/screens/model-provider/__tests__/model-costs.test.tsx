/**
 * @vitest-environment jsdom
 *
 * LLM Model Costs, driven the way a reader drives it.
 *
 * `platform/app/src/pages/settings/model-costs.tsx` and the component it wrapped
 * had NO test of their own — only the drawer beneath them did — so these are
 * new, and they pin the three things the move could plausibly have broken: the
 * grant on the write control, the address each editor action writes, and the
 * failure path handing the raw error to the host rather than composing a
 * sentence out of it.
 *
 * Spec: specs/model-providers/model-cost-scoping.feature
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing";

const { mockState, mockDelete, mockRefetch } = vi.hoisted(() => ({
  mockState: { costs: [] as Array<Record<string, unknown>> },
  mockDelete: vi.fn(),
  mockRefetch: vi.fn(),
}));

vi.mock("../../../behavior/model-provider-api", () => ({
  modelProviderApi: {
    llmModelCost: {
      getAllForProject: {
        useQuery: () => ({
          data: mockState.costs,
          isLoading: false,
          refetch: mockRefetch,
        }),
      },
      delete: { useMutation: () => ({ mutate: mockDelete, isPending: false }) },
    },
  },
}));

vi.mock("@langwatch/design-system/page-layout", () => ({
  PageLayout: {
    Header: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    HeaderButton: ({ children, ...props }: { children?: ReactNode; disabled?: boolean }) => (
      <button data-testid="add-model-cost" {...props}>
        {children}
      </button>
    ),
  },
}));

// Menu content renders inline so a pick is one click away.
vi.mock("@langwatch/design-system/menu", () => ({
  Menu: {
    Root: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Trigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Content: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Item: ({
      children,
      value,
      onClick,
    }: {
      children?: ReactNode;
      value?: string;
      onClick?: (event: { stopPropagation: () => void }) => void;
    }) => (
      <div data-menu-item={value} onClick={onClick}>
        {children}
      </div>
    ),
  },
}));

const { default: ModelCostsScreen } = await import("../model-costs.screen");

const CATALOGUE_ROW = {
  id: null,
  projectId: null,
  model: "openai/gpt-5.5",
  regex: "^openai/gpt-5\\.5$",
  inputCostPerToken: 0.000001,
  outputCostPerToken: 0.000002,
  cacheReadCostPerToken: null,
  cacheCreationCostPerToken: null,
  cacheCreation1hCostPerToken: null,
  updatedAt: null,
};

const STORED_ROW = {
  ...CATALOGUE_ROW,
  id: "cost_1",
  projectId: "proj-1",
  model: "anthropic/claude-sonnet-4-6",
  regex: "^anthropic/claude",
  updatedAt: new Date("2026-05-15T12:00:00Z"),
};

function renderScreen(host = new FakeModelProviderHost()) {
  return renderWithModelProviderHost(<ModelCostsScreen />, host);
}

describe("given the LLM Model Costs screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.costs = [CATALOGUE_ROW, STORED_ROW];
  });

  afterEach(() => cleanup());

  describe("when the reader may manage the project", () => {
    it("offers adding a cost rule", () => {
      renderScreen();

      expect(screen.getByTestId("add-model-cost").hasAttribute("disabled")).toBe(false);
    });

    it("addresses the cost editor with no row, so it opens in create mode", () => {
      const { host } = renderScreen();

      fireEvent.click(screen.getByTestId("add-model-cost"));

      expect(host.drawerOpens).toEqual([{ drawer: "llmModelCost", params: {} }]);
    });
  });

  describe("when the reader may not manage the project", () => {
    it("blocks adding a cost rule", () => {
      renderScreen(new FakeModelProviderHost({ grants: new Set([]) }));

      expect(screen.getByTestId("add-model-cost").hasAttribute("disabled")).toBe(true);
    });
  });

  describe("when a rule comes from the model catalogue rather than a stored row", () => {
    it("offers cloning it rather than editing a row that does not exist", () => {
      const { host } = renderScreen();

      const clone = document.querySelector('[data-menu-item="clone"]');
      expect(clone).toBeTruthy();

      fireEvent.click(clone!);

      expect(host.drawerOpens).toEqual([
        { drawer: "llmModelCost", params: { cloneModel: "openai/gpt-5.5" } },
      ]);
    });
  });

  describe("when a rule is a stored row", () => {
    it("addresses the editor with that row's id", () => {
      const { host } = renderScreen();

      fireEvent.click(document.querySelector('[data-menu-item="edit"]')!);

      expect(host.drawerOpens).toEqual([{ drawer: "llmModelCost", params: { id: "cost_1" } }]);
    });

    it("deletes it against the project it belongs to", () => {
      renderScreen();

      fireEvent.click(document.querySelector('[data-menu-item="delete"]')!);

      expect(mockDelete).toHaveBeenCalledWith(
        { projectId: "proj-1", id: "cost_1" },
        expect.anything(),
      );
    });

    it("confirms the deletion and refreshes the table", () => {
      renderScreen();

      fireEvent.click(document.querySelector('[data-menu-item="delete"]')!);
      const { onSuccess } = mockDelete.mock.calls[0]![1] as { onSuccess: () => void };
      onSuccess();

      expect(mockRefetch).toHaveBeenCalled();
    });

    it("hands a refusal to the host rather than composing its own sentence", () => {
      const { host } = renderScreen();

      fireEvent.click(document.querySelector('[data-menu-item="delete"]')!);
      const { onError } = mockDelete.mock.calls[0]![1] as { onError: (error: unknown) => void };
      const refusal = { data: { error: { code: "insufficient_permissions" } } };
      onError(refusal);

      expect(host.failures).toEqual([
        { error: refusal, fallbackTitle: "Error deleting LLM model cost" },
      ]);
    });

    it("stays silent when the application already reported the failure itself", () => {
      const { host } = renderScreen(new FakeModelProviderHost({ reportedGlobally: true }));

      fireEvent.click(document.querySelector('[data-menu-item="delete"]')!);
      const { onError } = mockDelete.mock.calls[0]![1] as { onError: (error: unknown) => void };
      onError(new Error("boom"));

      expect(host.failures).toEqual([]);
    });
  });
});
