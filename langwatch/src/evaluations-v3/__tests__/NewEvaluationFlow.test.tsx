/**
 * @vitest-environment jsdom
 *
 * Integration tests for the new evaluation creation flow.
 * Tests the scenarios where:
 * 1. User creates a new evaluation from the index page
 * 2. User navigates directly to a slug URL
 * 3. User navigates to an existing evaluation
 *
 * These tests verify that "not found" is never shown during the normal
 * evaluation creation flow, even when the API initially returns NOT_FOUND.
 */
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

// Autosave debounce delay (must match the constant in useAutosaveEvaluationsV3.ts)
const AUTOSAVE_DEBOUNCE_MS = 1500;

// Mock state for controlling query behavior
let mockQueryState = {
  data: null as { id: string; slug: string; name: string; wizardState: null } | null,
  isLoading: false,
  error: null as { data?: { code: string; httpStatus: number } } | null,
  isError: false,
};

// Mock tRPC API - must use hoisted mocks
const mockMutateAsync = vi.hoisted(() => vi.fn());

vi.mock("../../utils/api", () => ({
  api: {
    experiments: {
      saveEvaluationsV3: {
        useMutation: () => ({
          mutateAsync: mockMutateAsync,
          isPending: false,
        }),
      },
      getEvaluationsV3BySlug: {
        useQuery: () => mockQueryState,
      },
    },
  },
}));

// Mock next/router with controllable query
let mockRouterQuery = { slug: "new-test-slug" };
const mockRouterReplace = vi.fn();

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    push: vi.fn(),
    replace: mockRouterReplace,
  }),
}));

// Mock organization hook
vi.mock("../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id", slug: "test-project" },
  }),
}));

// Mock toaster
vi.mock("../../components/ui/toaster", () => ({
  toaster: {
    create: vi.fn(),
  },
}));

// Mock posthog
vi.mock("../../utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

// Import hook after mocks
import { useAutosaveEvaluationsV3 } from "../hooks/useAutosaveEvaluationsV3";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Test component that displays the hook's state
const TestEvaluationPage = () => {
  const { isLoading, isNotFound, isError, error } = useAutosaveEvaluationsV3();
  const store = useEvaluationsV3Store();

  return (
    <div>
      {isLoading && <div data-testid="loading">Loading...</div>}
      {isNotFound && <div data-testid="not-found">Evaluation not found</div>}
      {isError && <div data-testid="error">Error: {error?.message}</div>}
      {!isLoading && !isNotFound && !isError && (
        <div data-testid="content">
          <div data-testid="experiment-id">{store.experimentId ?? "no-id"}</div>
          <div data-testid="experiment-slug">{store.experimentSlug ?? "no-slug"}</div>
        </div>
      )}
    </div>
  );
};

describe("New evaluation creation flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock state to simulate new slug (NOT_FOUND response)
    mockQueryState = {
      data: null,
      isLoading: false,
      error: { data: { code: "NOT_FOUND", httpStatus: 404 } },
      isError: true,
    };

    // Reset router query
    mockRouterQuery = { slug: "new-test-slug" };

    // Reset mutation mock to success
    mockMutateAsync.mockResolvedValue({
      id: "created-experiment-id",
      slug: "new-test-slug",
      name: "New Evaluation",
    });

    // Reset store
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not show 'not found' when creating a new evaluation", async () => {
    // Scenario: User goes to /v3 which redirects to /v3/[newSlug]
    // The API returns NOT_FOUND because the experiment doesn't exist yet
    // But we should NOT show "not found" - autosave will create it

    render(<TestEvaluationPage />, { wrapper: Wrapper });

    // Should show content immediately, never "not found"
    expect(screen.queryByTestId("not-found")).not.toBeInTheDocument();

    // Content should be visible
    await waitFor(() => {
      expect(screen.getByTestId("content")).toBeInTheDocument();
    });

    // Wait for autosave to complete
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled();
    }, { timeout: AUTOSAVE_DEBOUNCE_MS + 2000 });

    // Still should not show "not found"
    expect(screen.queryByTestId("not-found")).not.toBeInTheDocument();
  });

  it("shows content while autosave is in progress", async () => {
    // Make autosave take longer
    mockMutateAsync.mockImplementation(() =>
      new Promise((resolve) =>
        setTimeout(() => resolve({
          id: "created-experiment-id",
          slug: "new-test-slug",
          name: "New Evaluation",
        }), 500)
      )
    );

    render(<TestEvaluationPage />, { wrapper: Wrapper });

    // Content should be visible immediately
    await waitFor(() => {
      expect(screen.getByTestId("content")).toBeInTheDocument();
    });

    // Should never show "not found" during the entire process
    expect(screen.queryByTestId("not-found")).not.toBeInTheDocument();

    // Wait for autosave to complete
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled();
    }, { timeout: AUTOSAVE_DEBOUNCE_MS + 2000 });

    // Still no "not found"
    expect(screen.queryByTestId("not-found")).not.toBeInTheDocument();
  });

  it("updates experiment ID after autosave completes", async () => {
    render(<TestEvaluationPage />, { wrapper: Wrapper });

    // Initially no experiment ID
    await waitFor(() => {
      expect(screen.getByTestId("experiment-id")).toHaveTextContent("no-id");
    });

    // Wait for autosave to complete and update the store
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalled();
    }, { timeout: AUTOSAVE_DEBOUNCE_MS + 2000 });

    // After autosave, experiment ID should be set
    await waitFor(() => {
      expect(screen.getByTestId("experiment-id")).toHaveTextContent("created-experiment-id");
    });
  });

  it("shows content for any slug, even random ones", async () => {
    // Scenario: User types a random slug in the URL
    // The API returns NOT_FOUND, but autosave will create it
    mockRouterQuery = { slug: "random-user-typed-slug" };
    mockMutateAsync.mockResolvedValue({
      id: "created-for-random-slug",
      slug: "random-user-typed-slug",
      name: "New Evaluation",
    });

    render(<TestEvaluationPage />, { wrapper: Wrapper });

    // Should show content, not "not found"
    await waitFor(() => {
      expect(screen.getByTestId("content")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("not-found")).not.toBeInTheDocument();
  });
});

describe("Loading existing evaluation", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store
    useEvaluationsV3Store.getState().reset();

    // Reset mutation mock
    mockMutateAsync.mockResolvedValue({
      id: "existing-id",
      slug: "existing-slug",
      name: "Existing Evaluation",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("loads existing evaluation without showing 'not found'", async () => {
    // Scenario: User navigates to an existing evaluation
    mockRouterQuery = { slug: "existing-slug" };
    mockQueryState = {
      data: {
        id: "existing-id",
        slug: "existing-slug",
        name: "Existing Evaluation",
        wizardState: null,
      },
      isLoading: false,
      error: null,
      isError: false,
    };

    render(<TestEvaluationPage />, { wrapper: Wrapper });

    // Should show content
    await waitFor(() => {
      expect(screen.getByTestId("content")).toBeInTheDocument();
    });

    // Should never show "not found"
    expect(screen.queryByTestId("not-found")).not.toBeInTheDocument();
  });

  it("shows loading state while fetching existing evaluation", async () => {
    mockRouterQuery = { slug: "loading-slug" };
    mockQueryState = {
      data: null,
      isLoading: true,
      error: null,
      isError: false,
    };

    render(<TestEvaluationPage />, { wrapper: Wrapper });

    // Should show loading
    expect(screen.getByTestId("loading")).toBeInTheDocument();

    // Should not show "not found"
    expect(screen.queryByTestId("not-found")).not.toBeInTheDocument();
  });
});

describe("Error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows error for permission denied (non-NOT_FOUND errors)", async () => {
    mockRouterQuery = { slug: "forbidden-slug" };
    mockQueryState = {
      data: null,
      isLoading: false,
      error: { data: { code: "FORBIDDEN", httpStatus: 403 } },
      isError: true,
    };

    render(<TestEvaluationPage />, { wrapper: Wrapper });

    // Should show error, not "not found"
    await waitFor(() => {
      expect(screen.getByTestId("error")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("not-found")).not.toBeInTheDocument();
  });
});
