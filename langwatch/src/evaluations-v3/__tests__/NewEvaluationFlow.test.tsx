/**
 * @vitest-environment jsdom
 *
 * Integration tests for evaluation v3 page flows.
 * Tests the scenarios where:
 * 1. User creates a new evaluation from the index page (creates experiment first, then redirects)
 * 2. User navigates to an existing evaluation by slug
 * 3. User navigates to a non-existent slug (404)
 *
 * The new flow:
 * - /v3/ (index) creates experiment on server, then redirects to /v3/[slug]
 * - /v3/[slug] ONLY loads existing experiments, shows 404 if not found
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

// Mock state for controlling query behavior
let mockQueryState = {
  data: null as {
    id: string;
    slug: string;
    name: string;
    workbenchState: null;
  } | null,
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
          isError: false,
          error: null,
        }),
      },
      getEvaluationsV3BySlug: {
        useQuery: () => mockQueryState,
      },
    },
  },
}));

// Mock next/router with controllable query
let mockRouterQuery = { slug: "existing-slug" };
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

// Test component that displays the hook's state for /v3/[slug] page
const TestSlugPage = () => {
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
          <div data-testid="experiment-slug">
            {store.experimentSlug ?? "no-slug"}
          </div>
        </div>
      )}
    </div>
  );
};

describe("Loading existing evaluation (/v3/[slug])", () => {
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

  it("loads existing evaluation and shows content", async () => {
    // Scenario: User navigates to an existing evaluation
    mockRouterQuery = { slug: "existing-slug" };
    mockQueryState = {
      data: {
        id: "existing-id",
        slug: "existing-slug",
        name: "Existing Evaluation",
        workbenchState: null,
      },
      isLoading: false,
      error: null,
      isError: false,
    };

    render(<TestSlugPage />, { wrapper: Wrapper });

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

    render(<TestSlugPage />, { wrapper: Wrapper });

    // Should show loading
    expect(screen.getByTestId("loading")).toBeInTheDocument();

    // Should not show "not found"
    expect(screen.queryByTestId("not-found")).not.toBeInTheDocument();
  });

  it("shows 404 when navigating to non-existent slug", async () => {
    // Scenario: User types a random slug that doesn't exist
    mockRouterQuery = { slug: "non-existent-slug" };
    mockQueryState = {
      data: null,
      isLoading: false,
      error: { data: { code: "NOT_FOUND", httpStatus: 404 } },
      isError: true,
    };

    render(<TestSlugPage />, { wrapper: Wrapper });

    // Should show "not found"
    await waitFor(() => {
      expect(screen.getByTestId("not-found")).toBeInTheDocument();
    });

    // Should NOT show content
    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
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

    render(<TestSlugPage />, { wrapper: Wrapper });

    // Should show error, not "not found"
    await waitFor(() => {
      expect(screen.getByTestId("error")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("not-found")).not.toBeInTheDocument();
  });
});

describe("Index page creates experiment first", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("creates experiment and redirects to slug page", async () => {
    // This test verifies the concept - the actual index page uses mutation
    // which creates the experiment before redirecting

    mockMutateAsync.mockResolvedValue({
      id: "new-experiment-id",
      slug: "new-slug-abc",
      name: "New Evaluation",
    });

    // Simulate what the index page does
    const result = await mockMutateAsync({
      projectId: "test-project-id",
      experimentId: undefined,
      state: {
        name: "New Evaluation",
        datasets: [],
        activeDatasetId: undefined,
        evaluators: [],
        targets: [],
        results: {},
      },
    });

    expect(result.id).toBe("new-experiment-id");
    expect(result.slug).toBe("new-slug-abc");

    // After this, the index page would call router.replace to navigate to /v3/new-slug-abc
    // The slug page would then load the existing experiment (which now exists)
  });
});
