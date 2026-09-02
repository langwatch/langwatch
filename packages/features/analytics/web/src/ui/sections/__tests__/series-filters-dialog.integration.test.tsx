/**
 * @vitest-environment jsdom
 *
 * What the series filter editor does when it is handed nothing.
 *
 * The regression this file was written for is `platform/app`'s:
 * `SeriesFiltersDrawer` was opened through the drawer REGISTRY, and the
 * registry could not carry a function or an object across a reload — so a
 * refresh with `?drawer.open=seriesFilters` on the address re-mounted it with
 * `filters` and `onChange` both `undefined`, the field editor read
 * `filters["traces.origin"]` off undefined, and the crash took the whole drawer
 * mount down with it.
 *
 * MOUNTED INLINE, THAT ADDRESS CANNOT HAPPEN — a dialog rendered by the builder
 * always has the builder's props. The scenarios are kept anyway, because
 * "renders with no filters" is still true of a series nobody has narrowed yet,
 * and because a defensive default that stops being exercised is a defensive
 * default that quietly stops working.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing";
import type { FilterField } from "../../../model/analytics-filter-definition";
import type { FilterParam } from "../../../model/analytics-filter-params";
import { SeriesFiltersDialog } from "../series-filters-dialog";

vi.mock("../../../behavior/use-filter-params", () => ({
  useFilterParams: () => ({
    filterParams: {},
    queryOpts: { enabled: false },
    nonEmptyFilters: {},
    setFilters: vi.fn(),
  }),
}));

vi.mock("../../../behavior/analytics-api", () => ({
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
