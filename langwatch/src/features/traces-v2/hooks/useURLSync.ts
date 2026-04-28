/**
 * URL fragment synchronization for traces-v2 bar state.
 *
 * The bar state (active lens + query + timeRange + page + draft column /
 * grouping / sort overrides) is encoded into the URL fragment so it survives
 * refresh and is shareable. When the in-memory state matches a built-in lens
 * exactly, the fragment collapses to just `#<lensId>`. Deep-link query params
 * (trace, span, viz, mode) are intentionally left untouched.
 */
import { useEffect, useRef } from "react";
import { useFilterStore } from "../stores/filterStore";
import { useViewStore } from "../stores/viewStore";
import { getPresetById, matchPreset } from "../utils/timeRangePresets";
import {
  buildFragment,
  computeOverrides,
  isOverridesEmpty,
  parseFragment,
} from "../utils/urlState";

const DEFAULT_LENS_ID = "all-traces";
const DEFAULT_PRESET_ID = "30d";

function readFragment(): string {
  if (typeof window === "undefined") return "";
  return window.location.hash;
}

function writeFragment(fragmentBody: string): void {
  if (typeof window === "undefined") return;
  const newHash = fragmentBody ? `#${fragmentBody}` : "";
  const newURL = `${window.location.pathname}${window.location.search}${newHash}`;
  const currentURL = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (newURL === currentURL) return;
  window.history.replaceState(null, "", newURL || window.location.pathname);
}

/**
 * Hook that synchronizes bar state with the URL fragment.
 * Call once at the page level (TracesPage).
 */
export function useURLSync(): void {
  const isInitialized = useRef(false);

  const queryText = useFilterStore((s) => s.queryText);
  const timeRange = useFilterStore((s) => s.timeRange);
  const page = useFilterStore((s) => s.page);
  const applyQueryText = useFilterStore((s) => s.applyQueryText);
  const setTimeRange = useFilterStore((s) => s.setTimeRange);
  const setPage = useFilterStore((s) => s.setPage);

  const activeLensId = useViewStore((s) => s.activeLensId);
  const allLenses = useViewStore((s) => s.allLenses);
  const selectLens = useViewStore((s) => s.selectLens);
  // Setters are only used to apply legacy URL fragments on mount (back-compat
  // with shared URLs that still carry `cols`/`group`/`sort`). The URL-write
  // path no longer reads any of these from the store.
  const setSort = useViewStore((s) => s.setSort);
  const setGrouping = useViewStore((s) => s.setGrouping);
  const setVisibleColumns = useViewStore((s) => s.setVisibleColumns);

  // Initialize from fragment on mount
  useEffect(() => {
    if (isInitialized.current) return;
    isInitialized.current = true;

    const parsed = parseFragment(readFragment());
    if (!parsed) return;

    const lensExists = allLenses.some((l) => l.id === parsed.lensId);
    const targetLensId = lensExists ? parsed.lensId : DEFAULT_LENS_ID;
    selectLens(targetLensId);

    const { overrides } = parsed;
    if (overrides.query !== undefined) applyQueryText(overrides.query);
    if (overrides.preset !== undefined) {
      const preset = getPresetById(overrides.preset);
      if (preset) {
        const { from, to } = preset.compute();
        setTimeRange({ from, to, label: preset.label, presetId: preset.id });
      }
    } else if (
      overrides.timeFrom !== undefined &&
      overrides.timeTo !== undefined
    ) {
      const range = { from: overrides.timeFrom, to: overrides.timeTo };
      const preset = matchPreset(range);
      setTimeRange(
        preset ? { ...range, label: preset.label, presetId: preset.id } : range,
      );
    }
    if (overrides.columns) setVisibleColumns(overrides.columns);
    if (overrides.grouping) setGrouping(overrides.grouping);
    if (overrides.sort) setSort(overrides.sort);
    // Apply page last — applyQueryText/setTimeRange reset it to 1.
    if (overrides.page !== undefined) setPage(overrides.page);
  }, [
    allLenses,
    selectLens,
    applyQueryText,
    setTimeRange,
    setPage,
    setVisibleColumns,
    setGrouping,
    setSort,
  ]);

  // Sync state → fragment immediately. URL writes via `replaceState` are
  // cheap (no reflow, no navigation) and the user wants the URL to track
  // the editor live. Debouncing made the URL feel laggy compared to the
  // editor decorations.
  useEffect(() => {
    if (!isInitialized.current) return;

    const activeLens = allLenses.find((l) => l.id === activeLensId);
    if (!activeLens) return;

    const overrides = computeOverrides({
      activeLens,
      query: queryText,
      timeRange,
      defaultPresetId: DEFAULT_PRESET_ID,
      page,
      // columns / grouping / sort are tracked in `viewStore.draftState`
      // but no longer serialised into the URL — pass dummies that match
      // the lens defaults so `computeOverrides` doesn't see them as
      // diverged. The function ignores them anyway, but the type still
      // expects the fields.
      columns: activeLens.columns,
      grouping: activeLens.grouping,
      sort: activeLens.sort,
    });

    // Default lens with no overrides → empty fragment for clean URL.
    if (activeLensId === DEFAULT_LENS_ID && isOverridesEmpty(overrides)) {
      writeFragment("");
      return;
    }
    writeFragment(buildFragment(activeLensId, overrides));
  }, [activeLensId, allLenses, queryText, timeRange, page]);
}
