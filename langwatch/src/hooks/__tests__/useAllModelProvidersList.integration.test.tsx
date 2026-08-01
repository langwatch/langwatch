/**
 * @vitest-environment jsdom
 * @regression
 *
 * Regression test for the #5380 render-loop class. `useAllModelProvidersList`
 * must hand back a referentially STABLE empty array while its query has no
 * data (a disabled, in-flight, or errored query). A fresh `[]` per render
 * hands each render a new array reference; any consumer that lists
 * `providers` in an effect or memo dependency then re-fires every render —
 * the same infinite-render loop `useModelProviderForm`'s reset effect trips
 * on via `provider.extraHeaders`.
 *
 * This test EXECUTES the hook and observes the reference across renders; it
 * does not assert on source text. The mocked query is a realistic TanStack
 * Query v4 result (the repo pins react-query ^4.44.0), mirroring the boundary
 * mocks in
 * src/components/settings/__tests__/ModelProviderForm.edit-row-resolution.integration.test.tsx.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListAllForOrganizationForFrontendQuery,
  mockListAllForProjectForFrontendQuery,
} = vi.hoisted(() => ({
  mockListAllForOrganizationForFrontendQuery: vi.fn(),
  mockListAllForProjectForFrontendQuery: vi.fn(),
}));

// Only the two boundaries this hook actually reads are mocked: the tRPC
// flat-list queries and the org/team/project context.
vi.mock("../../utils/api", () => ({
  api: {
    modelProvider: {
      listAllForOrganizationForFrontend: {
        useQuery: mockListAllForOrganizationForFrontendQuery,
      },
      listAllForProjectForFrontend: {
        useQuery: mockListAllForProjectForFrontendQuery,
      },
    },
  },
}));

vi.mock("../useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", name: "Web App", slug: "web-app" },
    organization: { id: "org-1", name: "Acme" },
    // `organization:view` granted → the hook reads the org-wide flat list, so
    // the organization query below is the active one.
    hasPermission: () => true,
  }),
}));

import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";
import { useAllModelProvidersList } from "../useAllModelProvidersList";

/**
 * Minimal but realistic TanStack Query v4 result. The hook gates on
 * `isSuccess`/`isError` (not just `isLoading`) to tell "the list definitively
 * arrived" apart from "not loaded yet", so the full status triplet must be
 * present or those gates silently read `undefined`.
 */
function readyQueryResult<T>(data: T) {
  return {
    data,
    isSuccess: true,
    isError: false,
    isLoading: false,
    status: "success" as const,
    refetch: vi.fn(),
  };
}

function notReadyQueryResult() {
  return {
    data: undefined,
    isSuccess: false,
    isError: false,
    isLoading: true,
    status: "loading" as const,
    refetch: vi.fn(),
  };
}

/**
 * Both queries always run (React requires every hook to execute); only the
 * organization one is active here. Priming both mirrors the real render.
 */
function primeBothQueries<T extends object>(result: T) {
  mockListAllForOrganizationForFrontendQuery.mockReturnValue(result);
  mockListAllForProjectForFrontendQuery.mockReturnValue(result);
}

function makeProvider(
  overrides: Partial<MaybeStoredModelProvider> = {},
): MaybeStoredModelProvider {
  return {
    id: "row-a",
    name: "OpenAI",
    provider: "openai",
    enabled: true,
    customKeys: null,
    models: null,
    embeddingsModels: null,
    customModels: null,
    customEmbeddingsModels: null,
    disabledByDefault: false,
    deploymentMapping: null,
    extraHeaders: [],
    scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
    scopeType: "ORGANIZATION",
    scopeId: "org-1",
    ...overrides,
  };
}

describe("useAllModelProvidersList()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the query has no data yet (disabled, in-flight, or errored)", () => {
    describe("when the hook re-renders with unchanged inputs", () => {
      it("returns the same providers array reference across renders", () => {
        primeBothQueries(notReadyQueryResult());

        const { result, rerender } = renderHook(() =>
          useAllModelProvidersList(),
        );
        const first = result.current.providers;

        rerender();
        const second = result.current.providers;

        // Empty list (no rows) — but, crucially, the SAME empty list each
        // render. A fresh `[]` per render is the reference churn that re-fires
        // dependent effects into an infinite loop (#5380).
        expect(first).toEqual([]);
        expect(second).toBe(first);
      });
    });
  });

  describe("given the query has resolved with rows", () => {
    describe("when the hook reads the resolved list", () => {
      it("returns the query's own providers array", () => {
        const rows: MaybeStoredModelProvider[] = [
          makeProvider({
            id: "row-a",
            scopeType: "ORGANIZATION",
            scopeId: "org-1",
          }),
          makeProvider({
            id: "row-b",
            scopeType: "PROJECT",
            scopeId: "proj-1",
          }),
        ];
        primeBothQueries(
          readyQueryResult({ providers: rows, modelMetadata: {} }),
        );

        const { result } = renderHook(() => useAllModelProvidersList());

        expect(result.current.providers).toBe(rows);
      });
    });
  });
});
