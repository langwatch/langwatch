/**
 * @vitest-environment jsdom
 *
 * The sidebar's facet vocabulary: a viewer answered `pending` asks again on
 * its own, so a lost `discover_updated` push never leaves it loading.
 * @see specs/traces-v2/search.feature
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  useQuery: vi.fn(),
  filter: { debouncedTimeRange: { from: 10, to: 20, label: "Last 1 hour" as string | undefined } },
}));

vi.mock("../../../../behavior/trace-api.ts", () => ({
  api: { traces: { discover: { useQuery: harness.useQuery } } },
}));

vi.mock("../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("../../../../behavior/explorer.store.ts", async () => {
  const actual = await vi.importActual<typeof actualModule>(
    "../../../../behavior/explorer.store.ts",
  );
  return {
    ...actual,
    useFilterStore: (selector: (s: unknown) => unknown) => selector(harness.filter),
  };
});

vi.mock("../../../../behavior/explorer/onboarding/use-preview-traces-active.ts", () => ({
  usePreviewTracesActive: () => false,
}));

import type * as actualModule from "../../../../behavior/explorer.store.ts";
import { useTraceFacets } from "../use-trace-facets.ts";

type RefetchInterval = (query: { state: { data: unknown } }) => number | false;

/** The poll the hook asked TanStack Query for, read against a last answer. */
function pollAfter(data: unknown): number | false {
  const options = harness.useQuery.mock.calls.at(-1)?.[1] as { refetchInterval: RefetchInterval };
  return options.refetchInterval({ state: { data } });
}

beforeEach(() => {
  harness.useQuery.mockReset();
  harness.useQuery.mockImplementation(() => ({
    data: undefined,
    isLoading: true,
    isSuccess: false,
    isPlaceholderData: false,
  }));
});

afterEach(() => vi.clearAllMocks());

describe("useTraceFacets", () => {
  describe("given the last discover answer was pending", () => {
    /** @scenario "A viewer answered pending asks again until the facets land" */
    it("asks again every few seconds", () => {
      renderHook(() => useTraceFacets());

      expect(pollAfter({ facets: [], pending: true })).toBe(5_000);
    });
  });

  describe("given the facets have landed or nothing has answered yet", () => {
    /** @scenario "A viewer answered pending asks again until the facets land" */
    it("does not poll", () => {
      renderHook(() => useTraceFacets());

      expect(pollAfter({ facets: [], pending: false })).toBe(false);
      expect(pollAfter(undefined)).toBe(false);
    });
  });
});
