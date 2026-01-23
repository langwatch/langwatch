/**
 * @vitest-environment jsdom
 *
 * Integration tests for NewEvaluationMenu.
 * Tests the dropdown menu with three options: Experiment, Online Evaluation, Guardrail.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { clearDrawerStack, clearFlowCallbacks } from "~/hooks/useDrawer";
import { NewEvaluationMenu } from "../NewEvaluationMenu";

// Router mock with mutable query state
let mockQuery: Record<string, string> = {};
const mockPush = vi.fn((url: string) => {
  const queryString = url.split("?")[1] ?? "";
  const params = new URLSearchParams(queryString);
  mockQuery = {};
  params.forEach((value, key) => {
    mockQuery[key] = value;
  });
  return Promise.resolve(true);
});

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: mockQuery,
    asPath:
      Object.keys(mockQuery).length > 0
        ? "/test?" + new URLSearchParams(mockQuery).toString()
        : "/test",
    push: mockPush,
    replace: mockPush,
  }),
}));

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: {
      id: "test-project-id",
      slug: "test-project",
      name: "Test Project",
    },
    hasPermission: () => true,
  }),
}));

// Mock tRPC API for experiment creation
let mockMutateCallback: ((data: unknown) => void) | null = null;
let mockOnSuccess: ((data: { slug: string }) => void) | null = null;
let mockIsPending = false;
const mockInvalidate = vi.fn(() => Promise.resolve());

vi.mock("~/utils/api", () => ({
  api: {
    useContext: vi.fn(() => ({
      experiments: {
        getAllForEvaluationsList: {
          invalidate: mockInvalidate,
        },
      },
    })),
    experiments: {
      saveEvaluationsV3: {
        useMutation: vi.fn(
          (options: {
            onSuccess?: (data: { slug: string }) => void;
            onError?: () => void;
          }) => {
            mockOnSuccess = options?.onSuccess ?? null;
            return {
              mutate: (data: unknown) => {
                mockMutateCallback?.(data);
              },
              isPending: mockIsPending,
            };
          },
        ),
      },
    },
  },
}));

// Mock humanReadableId to return predictable values
vi.mock("~/utils/humanReadableId", () => ({
  generateHumanReadableId: vi.fn(() => "swift-bright-fox"),
}));

// Wrapper with ChakraProvider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("NewEvaluationMenu", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockQuery = {};
    mockPush.mockClear();
    mockInvalidate.mockClear();
    mockMutateCallback = null;
    mockOnSuccess = null;
    mockIsPending = false;
    clearDrawerStack();
    clearFlowCallbacks();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  describe("Menu button", () => {
    it("renders the New Evaluation button", async () => {
      render(<NewEvaluationMenu />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("New Evaluation")).toBeInTheDocument();
      });
    });
  });

  describe("Menu options", () => {
    const openMenu = async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<NewEvaluationMenu />, { wrapper: Wrapper });

      await user.click(screen.getByText("New Evaluation"));
    };

    it("shows Create Experiment option when menu is open", async () => {
      await openMenu();

      await waitFor(() => {
        expect(screen.getByText("Create Experiment")).toBeInTheDocument();
      });
    });

    it("shows Add Online Evaluation option when menu is open", async () => {
      await openMenu();

      await waitFor(() => {
        expect(screen.getByText("Add Online Evaluation")).toBeInTheDocument();
      });
    });

    it("shows Setup Guardrail option when menu is open", async () => {
      await openMenu();

      await waitFor(() => {
        expect(screen.getByText("Setup Guardrail")).toBeInTheDocument();
      });
    });

    it("shows experiment description", async () => {
      await openMenu();

      await waitFor(() => {
        expect(
          screen.getByText(/compare prompts and agents performance/i),
        ).toBeInTheDocument();
      });
    });

    it("shows online evaluation description", async () => {
      await openMenu();

      await waitFor(() => {
        expect(screen.getByText(/monitor live traces/i)).toBeInTheDocument();
      });
    });

    it("shows guardrail description", async () => {
      await openMenu();

      await waitFor(() => {
        expect(
          screen.getByText(/block dangerous requests/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Create Experiment option", () => {
    it("calls mutation with generated name when clicked", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      let mutateData: unknown = null;
      mockMutateCallback = (data) => {
        mutateData = data;
      };

      render(<NewEvaluationMenu />, { wrapper: Wrapper });

      await user.click(screen.getByText("New Evaluation"));

      await waitFor(() => {
        expect(screen.getByText("Create Experiment")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Create Experiment"));

      await waitFor(() => {
        expect(mutateData).not.toBeNull();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((mutateData as any).state.experimentSlug).toBe(
          "swift-bright-fox",
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((mutateData as any).projectId).toBe("test-project-id");
      });
    });

    it("redirects to v3 page on successful creation", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockMutateCallback = () => {
        // Simulate async mutation success
        setTimeout(() => {
          mockOnSuccess?.({ slug: "swift-bright-fox" });
        }, 10);
      };

      render(<NewEvaluationMenu />, { wrapper: Wrapper });

      await user.click(screen.getByText("New Evaluation"));

      await waitFor(() => {
        expect(screen.getByText("Create Experiment")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Create Experiment"));

      // Wait for the mutation to complete and redirect
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith(
          "/test-project/experiments/workbench/swift-bright-fox",
        );
      });
    });

    it("uses human-readable ID as both name and slug", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      let mutateData: unknown = null;
      mockMutateCallback = (data) => {
        mutateData = data;
      };

      render(<NewEvaluationMenu />, { wrapper: Wrapper });

      await user.click(screen.getByText("New Evaluation"));
      await waitFor(() =>
        expect(screen.getByText("Create Experiment")).toBeInTheDocument(),
      );
      await user.click(screen.getByText("Create Experiment"));

      await waitFor(() => {
        expect(mutateData).not.toBeNull();
        // The name in the state should be the human-readable ID
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((mutateData as any).state.name).toBe("swift-bright-fox");
        // The slug should also be the human-readable ID
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((mutateData as any).state.experimentSlug).toBe(
          "swift-bright-fox",
        );
      });
    });

    it("invalidates experiments list on successful creation", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mockMutateCallback = () => {
        // Simulate async mutation success
        setTimeout(() => {
          mockOnSuccess?.({ slug: "swift-bright-fox" });
        }, 10);
      };

      render(<NewEvaluationMenu />, { wrapper: Wrapper });

      await user.click(screen.getByText("New Evaluation"));
      await waitFor(() =>
        expect(screen.getByText("Create Experiment")).toBeInTheDocument(),
      );
      await user.click(screen.getByText("Create Experiment"));

      // Wait for the mutation to complete
      await waitFor(() => {
        expect(mockInvalidate).toHaveBeenCalled();
      });
    });
  });

  describe("Add Online Evaluation option", () => {
    it("opens online evaluation drawer when clicked", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<NewEvaluationMenu />, { wrapper: Wrapper });

      await user.click(screen.getByText("New Evaluation"));

      await waitFor(() => {
        expect(screen.getByText("Add Online Evaluation")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Add Online Evaluation"));

      // Should update query to open drawer
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalled();
        const pushCall = mockPush.mock.calls[0]?.[0] as string;
        expect(pushCall).toContain("drawer.open=onlineEvaluation");
      });
    });
  });

  describe("Setup Guardrail option", () => {
    it("opens guardrails drawer when clicked", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<NewEvaluationMenu />, { wrapper: Wrapper });

      await user.click(screen.getByText("New Evaluation"));

      await waitFor(() => {
        expect(screen.getByText("Setup Guardrail")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Setup Guardrail"));

      // Should update query to open drawer
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalled();
        const pushCall = mockPush.mock.calls[0]?.[0] as string;
        expect(pushCall).toContain("drawer.open=guardrails");
      });
    });
  });
});
