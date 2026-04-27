/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCloseDrawer,
  mockToasterCreate,
  mockCreateOrUpdateMutate,
  mockIsHandledByGlobalHandler,
  mockMutationError,
  mockLlmModelCostsData,
} = vi.hoisted(() => {
  return {
    mockCloseDrawer: vi.fn(),
    mockToasterCreate: vi.fn(),
    mockCreateOrUpdateMutate: vi.fn(),
    mockIsHandledByGlobalHandler: vi.fn((_error: unknown) => false),
    mockMutationError: {
      current: null as Error | null,
    },
    mockLlmModelCostsData: {
      current: [
        {
          id: "cost-1",
          model: "gpt-4",
          regex: "gpt-4.*",
          inputCostPerToken: 0.00003,
          outputCostPerToken: 0.00006,
          projectId: "proj-1",
          updatedAt: new Date(),
        },
      ] as Array<{
        id?: string;
        model: string;
        regex: string;
        inputCostPerToken: number;
        outputCostPerToken: number;
        projectId?: string;
        updatedAt?: Date;
      }>,
    },
  };
});

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    project: { id: "proj-1", slug: "test-project" },
    hasPermission: () => true,
    hasOrgPermission: () => false,
    hasAnyPermission: () => false,
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
  }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: {
    create: (...args: unknown[]) => mockToasterCreate(...args),
  },
}));

vi.mock("~/utils/api", () => ({
  api: {
    llmModelCost: {
      getAllForProject: {
        useQuery: () => ({
          data: mockLlmModelCostsData.current,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      createOrUpdate: {
        useMutation: () => ({
          mutate: (data: unknown, options: { onError?: (error: unknown) => void }) => {
            mockCreateOrUpdateMutate(data, options);

            if (mockMutationError.current) {
              options.onError?.(mockMutationError.current);
            }
          },
          isLoading: false,
        }),
      },
      delete: {
        useMutation: () => ({
          mutate: vi.fn(),
          isLoading: false,
        }),
      },
    },
  },
}));

vi.mock("~/utils/trpcError", () => ({
  isHandledByGlobalHandler: (error: unknown) =>
    mockIsHandledByGlobalHandler(error),
}));

// Lazy imports to ensure mocks are set up first
const { LLMModelCostDrawer } = await import(
  "~/components/settings/LLMModelCostDrawer"
);

const Wrapper = ({ children }: { children?: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderDrawer(props: { id?: string; cloneModel?: string } = {}) {
  return render(
    <LLMModelCostDrawer {...props} />,
    { wrapper: Wrapper },
  );
}

async function submitStoredModelCost() {
  fireEvent.click(screen.getByRole("button", { name: /save/i }));

  await vi.waitFor(() => {
    expect(mockCreateOrUpdateMutate).toHaveBeenCalledTimes(1);
  });
}

describe("Feature: LLM model cost drawer save errors", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockMutationError.current = null;
    mockIsHandledByGlobalHandler.mockReturnValue(false);
    mockLlmModelCostsData.current = [
      {
        id: "cost-1",
        model: "gpt-4",
        regex: "gpt-4.*",
        inputCostPerToken: 0.00003,
        outputCostPerToken: 0.00006,
        projectId: "proj-1",
        updatedAt: new Date(),
      },
    ];
  });

  describe("<LLMModelCostDrawer/>", () => {
    describe("when the save error was already handled globally", () => {
      it("LLM model cost drawer skips the generic error toast after a primary error UI is shown", async () => {
        const error = new Error("Lite member restricted");
        mockMutationError.current = error;
        mockIsHandledByGlobalHandler.mockImplementation(
          (candidate: unknown) => candidate === error,
        );

        renderDrawer({ id: "cost-1" });

        await submitStoredModelCost();

        expect(mockToasterCreate).not.toHaveBeenCalled();
      });
    });

    describe("when the save error was not handled globally", () => {
      it("LLM model cost drawer shows the generic error toast when no primary error UI is shown", async () => {
        mockMutationError.current = new Error("Network error");

        renderDrawer({ id: "cost-1" });

        await submitStoredModelCost();

        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Error",
            description: "Network error",
            type: "error",
          }),
        );
      });
    });
  });
});
