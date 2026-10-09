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
  /**
   * The Instant Eval runs behind the query's `eval` chips, run key to run id,
   * written as one `run=<key>:<runId>` parameter each. Carried so a refresh
   * or a shared link reuses the judgements rather than paying for them again.
   */
  runs?: Record<string, string>;
}

export interface FragmentState {
  lensId: string;
  overrides: BarStateOverrides;
}

const RUN_PARAM = "run";

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** `<key>:<runId>` read back, or null for anything else. */
function parseRunEntry(entry: string): [string, string] | null {
  const separator = entry.indexOf(":");
  if (separator <= 0 || separator === entry.length - 1) return null;
  return [entry.slice(0, separator), entry.slice(separator + 1)];
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

    const runs: Record<string, string> = {};
    for (const entry of params.getAll(RUN_PARAM)) {
      const parsed = parseRunEntry(entry);
      if (parsed) runs[parsed[0]] = parsed[1];
    }
    if (Object.keys(runs).length > 0) overrides.runs = runs;
  }

  return { lensId, overrides };
}

interface ComputeOverridesInput {
  query: string;
  timeRange: { from: number; to: number; presetId?: string };
  defaultPresetId: string;
  /** Only the runs the query still names are worth an address. */
  runs?: Record<string, string>;
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
  if (input.runs && Object.keys(input.runs).length > 0) {
    overrides.runs = input.runs;
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
  if (overrides.runs) {
    for (const key of Object.keys(overrides.runs).sort()) {
      params.append(RUN_PARAM, `${key}:${overrides.runs[key]}`);
    }
  }
  const encodedLens = encodeURIComponent(lensId);
  const paramStr = params.toString();
  return paramStr ? `${encodedLens}?${paramStr}` : encodedLens;
}

export function isOverridesEmpty(overrides: BarStateOverrides): boolean {
  return Object.keys(overrides).length === 0;
}
