/**
 * @vitest-environment jsdom
 * Regression: the registry re-mounted `SeriesFiltersDrawer` with `filters`/
 * `onChange` undefined, crashing it. Mounted inline that can't happen, but stays tested.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";
import type { FilterField } from "../../../model/analytics-filter-definition.ts";
import type { FilterParam } from "../../../model/analytics-filter-params.ts";
import { SeriesFiltersDialog } from "../series-filters-dialog.tsx";

vi.mock("../../../behavior/use-filter-params.ts", () => ({
  useFilterParams: () => ({
    filterParams: {},
    queryOpts: { enabled: false },
    nonEmptyFilters: {},
    setFilters: vi.fn(),
  }),
}));

vi.mock("../../../behavior/analytics-api.ts", () => ({
  analyticsApi: {
    analytics: {
      dataForFilter: {
        useQuery: () => ({ data: { options: [] }, isLoading: false, isFetching: false }),
      },
    },
  },
}));

function renderDialog(props: Partial<Parameters<typeof SeriesFiltersDialog>[0]> = {}) {
  return render(
    <AnalyticsTestHarness host={new StubAnalyticsHost()}>
      <SeriesFiltersDialog
        open
        onOpenChange={vi.fn()}
        filters={{} as Record<FilterField, FilterParam>}
        onChange={vi.fn()}
        {...props}
      />
    </AnalyticsTestHarness>,
  );
}

describe("the series filter editor", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("given a series nobody has narrowed yet", () => {
    describe("when the editor opens", () => {
      it("renders rather than throwing on the absent filter record", () => {
        expect(() =>
          renderDialog({
            filters: void 0 as unknown as Record<FilterField, FilterParam>,
          }),
        ).not.toThrow();
      });

      it("offers every filter field with nothing selected", () => {
        renderDialog({
          filters: void 0 as unknown as Record<FilterField, FilterParam>,
        });

        expect(screen.getByText("Origin")).toBeInTheDocument();
        expect(screen.getByText("Model")).toBeInTheDocument();
      });
    });
  });

  describe("given the editor is open on a series", () => {
    describe("when it renders", () => {
      it("names what it edits and offers a way out", () => {
        renderDialog();

        expect(screen.getByText("Edit series filter")).toBeInTheDocument();
        expect(screen.getByText("Done")).toBeInTheDocument();
      });
    });
  });
});
