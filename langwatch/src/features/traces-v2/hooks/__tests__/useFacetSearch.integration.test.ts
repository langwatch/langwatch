/**
 * @vitest-environment jsdom
 *
 * useFacetSearch wires the per-facet value search to tracesV2.facetValues:
 * it forwards the typed `prefix`, gates the query on a project + a facetKey,
 * and is the shared engine behind useAttributeValues (which delegates to it
 * with no prefix and limit 30). See specs/traces-v2/search.feature.
 */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  useQuery: vi.fn(),
  projectId: { value: "proj-1" as string | undefined },
}));

vi.mock("~/utils/api", () => ({
  api: { tracesV2: { facetValues: { useQuery: harness.useQuery } } },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: harness.projectId.value
      ? { id: harness.projectId.value }
      : undefined,
  }),
}));

vi.mock("../../stores/filterStore", () => ({
  useFilterStore: (selector: (s: unknown) => unknown) =>
    selector({ debouncedTimeRange: { from: 10, to: 20, label: undefined } }),
}));

import { useAttributeValues } from "../useAttributeValues";
import { useFacetSearch } from "../useFacetSearch";

const lastInput = () => harness.useQuery.mock.calls.at(-1)?.[0];
const lastOpts = () => harness.useQuery.mock.calls.at(-1)?.[1];
const callFor = (facetKey: string) =>
  harness.useQuery.mock.calls.find((c) => c[0]?.facetKey === facetKey);

beforeEach(() => {
  harness.useQuery.mockReset();
  harness.useQuery.mockImplementation(() => ({
    data: undefined,
    isLoading: false,
  }));
  harness.projectId.value = "proj-1";
});

afterEach(() => vi.clearAllMocks());

describe("useFacetSearch", () => {
  describe("when enabled with a project and a facetKey", () => {
    it("forwards the typed prefix to facetValues", () => {
      renderHook(() =>
        useFacetSearch({ facetKey: "service", prefix: "fin", enabled: true }),
      );

      expect(lastInput()?.facetKey).toBe("service");
      expect(lastInput()?.prefix).toBe("fin");
      expect(lastOpts()?.enabled).toBe(true);
    });

    it("omits an all-whitespace prefix (sends undefined, not a blank string)", () => {
      renderHook(() =>
        useFacetSearch({ facetKey: "service", prefix: "   ", enabled: true }),
      );

      expect(lastInput()?.prefix).toBeUndefined();
    });
  });

  describe("when there is no project", () => {
    it("disables the query", () => {
      harness.projectId.value = undefined;
      renderHook(() =>
        useFacetSearch({ facetKey: "service", prefix: "fin", enabled: true }),
      );

      expect(lastOpts()?.enabled).toBe(false);
    });
  });

  describe("when the facetKey is empty", () => {
    it("disables the query", () => {
      renderHook(() =>
        useFacetSearch({ facetKey: "", prefix: "fin", enabled: true }),
      );

      expect(lastOpts()?.enabled).toBe(false);
    });
  });

  // Regression: useAttributeValues must keep delegating with the same shape
  // AttributeKeyRow has always relied on — an attribute-prefixed key, limit
  // 30, a 5-minute staleTime, and crucially NO prefix (it lazy-loads the top
  // values, it does not search them).
  describe("given useAttributeValues delegates to useFacetSearch", () => {
    it("queries facetValues with the attribute-prefixed key, limit 30, no prefix", () => {
      renderHook(() => useAttributeValues("langwatch.user_id", true));

      const call = callFor("attribute.langwatch.user_id");
      expect(call).toBeDefined();
      expect(call?.[0]?.limit).toBe(30);
      expect(call?.[0]?.prefix).toBeUndefined();
      expect(call?.[1]?.staleTime).toBe(5 * 60_000);
    });

    // The prefixed facetKey ("attribute.") is truthy even for an empty key, so
    // useFacetSearch's own `!!facetKey` guard would not catch it —
    // useAttributeValues must additionally gate on a non-empty attribute key.
    it("disables the query when the attribute key is empty", () => {
      renderHook(() => useAttributeValues("", true));

      expect(lastOpts()?.enabled).toBe(false);
    });
  });
});
