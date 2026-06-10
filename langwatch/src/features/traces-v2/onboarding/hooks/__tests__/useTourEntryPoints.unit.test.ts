// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mutable state ────────────────────────────────────────────────────────────

const mockListReset = vi.fn().mockResolvedValue(undefined);
const mockListInvalidate = vi.fn().mockResolvedValue(undefined);

let mockSetupDismissedByProject: Record<string, boolean> = {};
let mockTourActive = false;
const mockSetSetupDismissedForProject = vi.fn();
const mockSetTourActive = vi.fn();

// ─── Store / dependency mocks ─────────────────────────────────────────────────

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-tour-test" } }),
}));

vi.mock("../../../hooks/useProjectHasTraces", () => ({
  useProjectHasTraces: () => ({ hasAnyTraces: true }),
}));

vi.mock("../../store/onboardingStore", () => ({
  useOnboardingStore: (selector: (s: unknown) => unknown) =>
    selector({
      setupDismissedByProject: mockSetupDismissedByProject,
      setSetupDismissedForProject: mockSetSetupDismissedForProject,
      setTourActive: mockSetTourActive,
      tourActive: mockTourActive,
    }),
}));

vi.mock("../useOnboardingActive", () => ({
  useOnboardingActive: () => mockTourActive,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      tracesV2: {
        list: {
          reset: mockListReset,
          invalidate: mockListInvalidate,
        },
      },
    }),
  },
}));

// Stub store getState calls made in onLaunchTour
vi.mock("../../../stores/viewStore", () => ({
  useViewStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ activeLensId: "all-traces", sort: { columnId: "timestamp", direction: "desc" } }),
    { getState: () => ({ selectLens: vi.fn() }) },
  ),
}));

vi.mock("../../../stores/filterStore", () => ({
  useFilterStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({ debouncedQueryText: "", debouncedTimeRange: { from: 0, to: 1, label: "Last 24h" }, page: 1, pageSize: 20 }),
    {
      getState: () => ({
        clearAll: vi.fn(),
        setTimeRange: vi.fn(),
        commitDebounced: vi.fn(),
      }),
    },
  ),
  INITIAL_TIME_RANGE: { from: 0, to: 1, label: "Last 24h" },
}));

// ─── Module under test ────────────────────────────────────────────────────────
import { useTourEntryPoints } from "../useTourEntryPoints";

// ─── Test lifecycle ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSetupDismissedByProject = {};
  mockTourActive = false;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useTourEntryPoints", () => {
  describe("given the tour is active and the user ends it", () => {
    describe("when onEndTour is called", () => {
      it("resets the cache (not invalidates), dismisses the project, and clears tourActive", async () => {
        const { result } = renderHook(() => useTourEntryPoints());

        await act(async () => {
          result.current.onEndTour();
        });

        // Uses reset (not invalidate) — reset purges the cache so the next
        // fetch flows through skeleton, not stale sample rows.
        expect(mockListReset).toHaveBeenCalledTimes(1);
        expect(mockListInvalidate).not.toHaveBeenCalled();

        // Dismissal and tourActive cleared so the user lands on the real table.
        expect(mockSetSetupDismissedForProject).toHaveBeenCalledWith(
          "proj-tour-test",
          true,
        );
        expect(mockSetTourActive).toHaveBeenCalledWith(false);
      });
    });
  });
});
