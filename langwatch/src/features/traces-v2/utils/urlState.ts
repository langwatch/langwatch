import type { LensConfig } from "../stores/viewStore";

// Density is intentionally NOT serialised into the URL — it's a personal
// preference, not a shareable view setting. Lives in `densityStore.ts`.
//
// Column / grouping / sort drafts are also NOT serialised — they're per-user
// view tweaks, not shareable query state. They live in `viewStore`'s
// `draftState`; the lens tab shows an "unsaved" dot when any are active.
// To persist them across reloads, the user saves them into a (custom) lens.

export interface BarStateOverrides {
  query?: string;
  /** Rolling preset id (e.g. "7d"). When set, the range is computed at read
   *  time and stays anchored to "now" — this is what keeps URLs from getting
   *  stuck in the past. `timeFrom`/`timeTo` are only used for absolute ranges. */
  preset?: string;
  timeFrom?: number;
  timeTo?: number;
  page?: number;
}

export interface FragmentState {
  lensId: string;
  overrides: BarStateOverrides;
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
  }

  return { lensId, overrides };
}

interface ComputeOverridesInput {
  activeLens: LensConfig;
  query: string;
  timeRange: { from: number; to: number; presetId?: string };
  defaultPresetId: string;
  page: number;
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
  const encodedLens = encodeURIComponent(lensId);
  const paramStr = params.toString();
  return paramStr ? `${encodedLens}?${paramStr}` : encodedLens;
}

export function isOverridesEmpty(overrides: BarStateOverrides): boolean {
  return Object.keys(overrides).length === 0;
}
