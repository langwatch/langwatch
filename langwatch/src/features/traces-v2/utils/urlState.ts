import type {
  Density,
  GroupingMode,
  LensConfig,
  SortConfig,
} from "../stores/viewStore";

export interface BarStateOverrides {
  query?: string;
  /** Rolling preset id (e.g. "7d"). When set, the range is computed at read
   *  time and stays anchored to "now" — this is what keeps URLs from getting
   *  stuck in the past. `timeFrom`/`timeTo` are only used for absolute ranges. */
  preset?: string;
  timeFrom?: number;
  timeTo?: number;
  page?: number;
  columns?: string[];
  grouping?: GroupingMode;
  sort?: SortConfig;
  density?: Density;
}

export interface FragmentState {
  lensId: string;
  overrides: BarStateOverrides;
}

const VALID_GROUPINGS: ReadonlySet<GroupingMode> = new Set([
  "flat",
  "by-session",
  "by-service",
  "by-user",
  "by-model",
]);

function isGroupingMode(value: string): value is GroupingMode {
  return VALID_GROUPINGS.has(value as GroupingMode);
}

function isDensity(value: string): value is Density {
  return value === "compact" || value === "comfortable";
}

function parseSort(value: string): SortConfig | undefined {
  const colonAt = value.indexOf(":");
  if (colonAt < 0) return undefined;
  const columnId = value.slice(0, colonAt);
  const direction = value.slice(colonAt + 1);
  if (!columnId || (direction !== "asc" && direction !== "desc")) {
    return undefined;
  }
  return { columnId, direction };
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function parseFinitePositiveInt(value: string): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseFragment(fragment: string): FragmentState | null {
  const trimmed = fragment.replace(/^#/, "");
  if (!trimmed) return null;

  const [lensIdRaw, paramString] = trimmed.split("?", 2);
  const lensId = safeDecode(lensIdRaw ?? "");
  if (!lensId) return null;

  const overrides: BarStateOverrides = {};
  if (paramString) {
    const params = new URLSearchParams(paramString);

    const q = params.get("q");
    if (q !== null) overrides.query = q;

    const preset = params.get("preset");
    if (preset) {
      overrides.preset = preset;
    } else {
      const from = params.get("from");
      const to = params.get("to");
      if (from !== null && to !== null) {
        const fromN = Number(from);
        const toN = Number(to);
        if (Number.isFinite(fromN) && Number.isFinite(toN)) {
          overrides.timeFrom = fromN;
          overrides.timeTo = toN;
        }
      }
    }

    const page = params.get("page");
    if (page !== null) {
      const parsed = parseFinitePositiveInt(page);
      if (parsed !== undefined) overrides.page = parsed;
    }

    const cols = params.get("cols");
    if (cols !== null) {
      const list = cols.split(",").map((c) => c.trim()).filter(Boolean);
      if (list.length > 0) overrides.columns = list;
    }

    const group = params.get("group");
    if (group && isGroupingMode(group)) overrides.grouping = group;

    const sort = params.get("sort");
    if (sort !== null) {
      const parsed = parseSort(sort);
      if (parsed) overrides.sort = parsed;
    }

    const density = params.get("density");
    if (density && isDensity(density)) overrides.density = density;
  }

  return { lensId, overrides };
}

interface ComputeOverridesInput {
  activeLens: LensConfig;
  query: string;
  timeRange: { from: number; to: number; presetId?: string };
  defaultPresetId: string;
  page: number;
  columns: string[];
  grouping: GroupingMode;
  sort: SortConfig;
  density: Density;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sortsEqual(a: SortConfig, b: SortConfig): boolean {
  return a.columnId === b.columnId && a.direction === b.direction;
}

export function computeOverrides(
  input: ComputeOverridesInput,
): BarStateOverrides {
  const overrides: BarStateOverrides = {};
  if (input.query) overrides.query = input.query;
  if (input.timeRange.presetId) {
    if (input.timeRange.presetId !== input.defaultPresetId) {
      overrides.preset = input.timeRange.presetId;
    }
  } else {
    overrides.timeFrom = input.timeRange.from;
    overrides.timeTo = input.timeRange.to;
  }
  if (input.page !== 1) overrides.page = input.page;
  if (!arraysEqual(input.columns, input.activeLens.columns)) {
    overrides.columns = input.columns;
  }
  if (input.grouping !== input.activeLens.grouping) {
    overrides.grouping = input.grouping;
  }
  if (!sortsEqual(input.sort, input.activeLens.sort)) {
    overrides.sort = input.sort;
  }
  if (input.density !== input.activeLens.density) {
    overrides.density = input.density;
  }
  return overrides;
}

export function buildFragment(
  lensId: string,
  overrides: BarStateOverrides,
): string {
  const params = new URLSearchParams();
  if (overrides.query) params.set("q", overrides.query);
  if (overrides.preset) {
    params.set("preset", overrides.preset);
  } else if (
    overrides.timeFrom !== undefined &&
    overrides.timeTo !== undefined
  ) {
    params.set("from", String(overrides.timeFrom));
    params.set("to", String(overrides.timeTo));
  }
  if (overrides.page !== undefined) params.set("page", String(overrides.page));
  if (overrides.columns) params.set("cols", overrides.columns.join(","));
  if (overrides.grouping) params.set("group", overrides.grouping);
  if (overrides.sort) {
    params.set("sort", `${overrides.sort.columnId}:${overrides.sort.direction}`);
  }
  if (overrides.density) params.set("density", overrides.density);
  const encodedLens = encodeURIComponent(lensId);
  const paramStr = params.toString();
  return paramStr ? `${encodedLens}?${paramStr}` : encodedLens;
}

export function isOverridesEmpty(overrides: BarStateOverrides): boolean {
  for (const _ in overrides) return false;
  return true;
}
