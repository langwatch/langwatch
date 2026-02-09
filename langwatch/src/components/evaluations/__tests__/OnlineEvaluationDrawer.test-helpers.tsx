/**
 * Shared test helpers for OnlineEvaluationDrawer test files.
 *
 * Contains mock data, mutable state holders, mock function references,
 * and factory functions for vi.mock() calls.
 *
 * IMPORTANT: vi.mock() must be called in each test file (vitest hoists them per-file).
 * The factory functions here are called FROM those vi.mock() calls.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { vi } from "vitest";
import type React from "react";

// Standard evaluator output fields
export const standardOutputFields = [
  { identifier: "passed", type: "bool" },
  { identifier: "score", type: "float" },
  { identifier: "label", type: "str" },
  { identifier: "details", type: "str" },
];

// Mock evaluator data with fields pre-computed (as returned by API)
export const mockEvaluators = [
  {
    id: "evaluator-1",
    name: "PII Check",
    slug: "pii-check-abc12",
    type: "evaluator",
    config: {
      evaluatorType: "presidio/pii_detection",
      settings: { sensitivityLevel: "high" },
    },
    workflowId: null,
    copiedFromEvaluatorId: null,
    projectId: "test-project-id",
    archivedAt: null,
    createdAt: new Date("2025-01-10T10:00:00Z"),
    updatedAt: new Date("2025-01-15T10:00:00Z"),
    fields: [{ identifier: "input", type: "str" }],
    outputFields: standardOutputFields,
  },
  {
    id: "evaluator-2",
    name: "Exact Match",
    slug: "exact-match-def34",
    type: "evaluator",
    config: {
      evaluatorType: "langevals/exact_match",
      settings: { caseSensitive: false },
    },
    workflowId: null,
    copiedFromEvaluatorId: null,
    projectId: "test-project-id",
    archivedAt: null,
    createdAt: new Date("2025-01-05T10:00:00Z"),
    updatedAt: new Date("2025-01-12T10:00:00Z"),
    fields: [
      { identifier: "output", type: "str" },
      { identifier: "expected_output", type: "str" },
    ],
    outputFields: standardOutputFields,
  },
  // Evaluator with required input/output fields (for auto-inference testing)
  {
    id: "evaluator-3",
    name: "Answer Relevance",
    slug: "answer-relevance-ghi78",
    type: "evaluator",
    config: {
      evaluatorType: "legacy/ragas_answer_relevancy",
      settings: { model: "openai/gpt-4" },
    },
    workflowId: null,
    copiedFromEvaluatorId: null,
    projectId: "test-project-id",
    archivedAt: null,
    createdAt: new Date("2025-01-08T10:00:00Z"),
    updatedAt: new Date("2025-01-14T10:00:00Z"),
    fields: [
      { identifier: "input", type: "str" },
      { identifier: "output", type: "str" },
      { identifier: "contexts", type: "list", optional: true },
    ],
    outputFields: standardOutputFields,
  },
  // Evaluator with only optional fields (langevals/llm_boolean has requiredFields: [], optionalFields: ["input", "output", "contexts"])
  {
    id: "evaluator-4",
    name: "LLM Boolean Judge",
    slug: "llm-boolean-judge-jkl90",
    type: "evaluator",
    config: {
      evaluatorType: "langevals/llm_boolean",
      settings: { model: "openai/gpt-4" },
    },
    workflowId: null,
    copiedFromEvaluatorId: null,
    projectId: "test-project-id",
    archivedAt: null,
    createdAt: new Date("2025-01-09T10:00:00Z"),
    updatedAt: new Date("2025-01-16T10:00:00Z"),
    fields: [
      { identifier: "input", type: "str", optional: true },
      { identifier: "output", type: "str", optional: true },
      { identifier: "contexts", type: "list", optional: true },
    ],
    outputFields: standardOutputFields,
  },
  // Workflow-based evaluator (custom evaluator from workflow)
  // Uses "input" field so it auto-infers mapping at trace level for tests
  {
    id: "evaluator-5",
    name: "Custom Workflow Scorer",
    slug: "custom-workflow-scorer-wfl01",
    type: "workflow",
    config: {},
    workflowId: "workflow-123",
    copiedFromEvaluatorId: null,
    projectId: "test-project-id",
    archivedAt: null,
    createdAt: new Date("2025-01-11T10:00:00Z"),
    updatedAt: new Date("2025-01-17T10:00:00Z"),
    fields: [
      { identifier: "input", type: "str", optional: true },
      { identifier: "custom_context", type: "str", optional: true },
    ],
    outputFields: standardOutputFields,
  },
];

/**
 * Mutable shared state - each test file's beforeEach resets these.
 * Using an object so references are shared across modules.
 */
export const state = {
  mockQuery: {} as Record<string, string>,
  mockLicenseIsAllowed: true,
  mockMonitor: {
    id: "monitor-1",
    name: "My PII Monitor",
    checkType: "presidio/pii_detection",
    parameters: {},
    level: "trace" as "trace" | "thread",
    mappings: {
      mapping: {
        input: { source: "trace", key: "input" },
        output: { source: "trace", key: "output" },
      },
    },
    sample: 0.5,
    evaluatorId: "evaluator-1",
    projectId: "test-project-id",
    createdAt: new Date("2025-01-10T10:00:00Z"),
    updatedAt: new Date("2025-01-15T10:00:00Z"),
  },
};

// Mock function references - shared across test files
export const mockPush = vi.fn((url: string) => {
  const queryString = url.split("?")[1] ?? "";
  const params = new URLSearchParams(queryString);
  state.mockQuery = {};
  params.forEach((value, key) => {
    state.mockQuery[key] = value;
  });
  return Promise.resolve(true);
});

export const mockCreateMutate = vi.fn();
export const mockUpdateMutate = vi.fn();
export const mockInvalidate = vi.fn();
export const mockEvaluatorCreateMutate = vi.fn();
export const mockEvaluatorUpdateMutate = vi.fn();
export const mockOpenUpgradeModal = vi.fn();
export const mockCheckAndProceed = vi.fn((callback: () => void) => {
  if (state.mockLicenseIsAllowed) {
    callback();
  } else {
    mockOpenUpgradeModal("onlineEvaluations", 3, 3);
  }
});

// Factory functions for vi.mock() calls

export function createRouterMock() {
  const routerProxy = {
    get query() {
      return state.mockQuery;
    },
    push: (url: string) => mockPush(url),
    replace: (url: string) => mockPush(url),
  };

  return {
    useRouter: () => {
      const asPath =
        Object.keys(state.mockQuery).length > 0
          ? "/test?" +
          Object.entries(state.mockQuery)
            .map(([k, v]) => `${k}=${v}`)
            .join("&")
          : "/test";
      return {
        query: state.mockQuery,
        asPath,
        push: mockPush,
        replace: mockPush,
      };
    },
    default: routerProxy,
  };
}

export function createApiMock() {
  return {
    api: {
      publicEnv: {
        useQuery: () => ({
          data: { IS_SAAS: false },
          isLoading: false,
        }),
      },
      evaluators: {
        getAll: {
          useQuery: vi.fn(() => ({
            data: mockEvaluators,
            isLoading: false,
          })),
        },
        getById: {
          useQuery: vi.fn(({ id }: { id: string }) => ({
            data: mockEvaluators.find((e) => e.id === id) ?? null,
            isLoading: false,
          })),
        },
        create: {
          useMutation: vi.fn(
            (options?: { onSuccess?: (evaluator: unknown) => void }) => ({
              mutate: (data: unknown) => {
                mockEvaluatorCreateMutate(data);
                options?.onSuccess?.(mockEvaluators[0]);
              },
              mutateAsync: async (data: unknown) => {
                mockEvaluatorCreateMutate(data);
                return mockEvaluators[0];
              },
              isPending: false,
            }),
          ),
        },
        update: {
          useMutation: vi.fn(
            (options?: { onSuccess?: (evaluator: unknown) => void }) => ({
              mutate: (data: unknown) => {
                mockEvaluatorUpdateMutate(data);
                options?.onSuccess?.(mockEvaluators[0]);
              },
              mutateAsync: async (data: unknown) => {
                mockEvaluatorUpdateMutate(data);
                return mockEvaluators[0];
              },
              isPending: false,
            }),
          ),
        },
        delete: {
          useMutation: vi.fn(() => ({
            mutate: vi.fn(),
            isPending: false,
          })),
        },
        getWorkflowFields: {
          useQuery: vi.fn(({ id }: { id: string }) => {
            const evaluator = mockEvaluators.find((e) => e.id === id);
            if (evaluator?.type === "workflow") {
              return {
                data: {
                  evaluatorId: id,
                  evaluatorType: "workflow",
                  fields: [
                    { identifier: "input", type: "str" },
                    { identifier: "output", type: "str" },
                  ],
                },
                isLoading: false,
              };
            }
            return {
              data: null,
              isLoading: false,
            };
          }),
        },
      },
      monitors: {
        getById: {
          useQuery: vi.fn(({ id }: { id: string }) => ({
            data: id === "monitor-1" ? state.mockMonitor : null,
            isLoading: false,
          })),
        },
        getAllForProject: {
          useQuery: vi.fn(() => ({
            data: [state.mockMonitor],
            isLoading: false,
          })),
        },
        create: {
          useMutation: vi.fn((options: { onSuccess?: () => void }) => ({
            mutate: (data: unknown) => {
              mockCreateMutate(data);
              options?.onSuccess?.();
            },
            isPending: false,
          })),
        },
        update: {
          useMutation: vi.fn((options: { onSuccess?: () => void }) => ({
            mutate: (data: unknown) => {
              mockUpdateMutate(data);
              options?.onSuccess?.();
            },
            isPending: false,
          })),
        },
      },
      traces: {
        getSampleTracesDataset: {
          useQuery: vi.fn(() => ({
            data: [
              {
                trace_id: "trace-1",
                spans: [
                  { name: "openai/gpt-4", type: "llm" },
                  { name: "my-custom-span", type: "span" },
                ],
              },
            ],
            isLoading: false,
            error: null,
          })),
        },
      },
      licenseEnforcement: {
        checkLimit: {
          useQuery: vi.fn(() => ({
            data: { allowed: true, current: 0, max: 100 },
            isLoading: false,
          })),
        },
      },
      useContext: vi.fn(() => ({
        evaluators: {
          getAll: { invalidate: mockInvalidate },
          getById: { invalidate: mockInvalidate },
        },
        monitors: {
          getAllForProject: { invalidate: mockInvalidate },
          getById: { invalidate: mockInvalidate },
        },
      })),
      modelProvider: {
        getAllForProject: {
          useQuery: vi.fn(() => ({
            data: {},
            isLoading: false,
          })),
        },
        getAllForProjectForFrontend: {
          useQuery: vi.fn(() => ({
            data: { providers: {}, modelMetadata: {} },
            isLoading: false,
            refetch: vi.fn(),
          })),
        },
      },
    },
  };
}

export function createOrgMock() {
  return {
    useOrganizationTeamProject: () => ({
      project: { id: "test-project-id", slug: "test-project" },
      organization: { id: "test-org-id" },
      team: { id: "test-team-id" },
    }),
  };
}

export function createUpgradeModalMock() {
  return {
    useUpgradeModalStore: (
      selector: (state: { open: typeof mockOpenUpgradeModal }) => unknown
    ) => {
      if (typeof selector === "function") {
        return selector({ open: mockOpenUpgradeModal });
      }
      return { open: mockOpenUpgradeModal };
    },
  };
}

export function createLicenseEnforcementMock() {
  return {
    useLicenseEnforcement: () => ({
      checkAndProceed: mockCheckAndProceed,
      isAllowed: state.mockLicenseIsAllowed,
      isLoading: false,
      limitInfo: state.mockLicenseIsAllowed
        ? { allowed: true, current: 2, max: 10 }
        : { allowed: false, current: 3, max: 3 },
    }),
  };
}

export const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/**
 * Reset all mutable state to defaults. Call in beforeEach of each test file.
 */
export function resetState() {
  state.mockQuery = {};
  state.mockLicenseIsAllowed = true;
  state.mockMonitor = {
    id: "monitor-1",
    name: "My PII Monitor",
    checkType: "presidio/pii_detection",
    parameters: {},
    level: "trace" as "trace" | "thread",
    mappings: {
      mapping: {
        input: { source: "trace", key: "input" },
        output: { source: "trace", key: "output" },
      },
    },
    sample: 0.5,
    evaluatorId: "evaluator-1",
    projectId: "test-project-id",
    createdAt: new Date("2025-01-10T10:00:00Z"),
    updatedAt: new Date("2025-01-15T10:00:00Z"),
  };
}
