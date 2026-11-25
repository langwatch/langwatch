// Density is intentionally NOT serialised into the URL — it's a personal preference,
// not a shareable view setting. Lives in `densityStore.ts`.

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

const RUN_PARAM = "run";

export interface FragmentState {
  lensId: string;
  overrides: BarStateOverrides;
}

export function parseFragment(fragment: string): FragmentState | null {
  const trimmed = fragment.replace(/^#/, "");
  if (!trimmed) return null;

  const [lensIdRaw, paramString] = trimmed.split("?", 2);
  let lensId: string;
  try {
    lensId = decodeURIComponent(lensIdRaw ?? "");
  } catch {
    return null;
  }
  if (!lensId) return null;

  return { lensId, overrides: paramString ? parseOverrides(paramString) : {} };
}

/** `<key>:<runId>` read back, or null for anything else. */
function parseRunEntry(entry: string): [string, string] | null {
  const separator = entry.indexOf(":");
  if (separator <= 0 || separator === entry.length - 1) return null;

  return [entry.slice(0, separator), entry.slice(separator + 1)];
}

/** The runs the fragment names, or none when it names none readable. */
function parseRuns(params: URLSearchParams): Record<string, string> | undefined {
  const runs: Record<string, string> = {};
  for (const entry of params.getAll(RUN_PARAM)) {
    const parsed = parseRunEntry(entry);
    if (parsed) runs[parsed[0]] = parsed[1];
  }

  return Object.keys(runs).length > 0 ? runs : void 0;
}

/** The bar-state overrides a fragment's query string carries. */
function parseOverrides(paramString: string): BarStateOverrides {
  const overrides: BarStateOverrides = {};
  const params = new URLSearchParams(paramString);

  const q = params.get("q");
  if (q !== null) overrides.query = q;

  const runs = parseRuns(params);
  if (runs) overrides.runs = runs;

  const preset = params.get("preset");
  if (preset) {
    overrides.preset = preset;
    return overrides;
  }

  const from = params.get("from");
  const to = params.get("to");
  if (from === null || to === null) return overrides;
  const fromN = Number(from);
  const toN = Number(to);
  const bothFinite = Number.isFinite(fromN) && Number.isFinite(toN);
  if (bothFinite) {
    overrides.timeFrom = fromN;
    overrides.timeTo = toN;
  }
  return overrides;
}

interface ComputeOverridesInput {
  query: string;
  timeRange: { from: number; to: number; presetId?: string };
  defaultPresetId: string;
  /** Only the runs the query still names are worth an address. */
  runs?: Record<string, string>;
}

export function computeOverrides(input: ComputeOverridesInput): BarStateOverrides {
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

export function buildFragment(lensId: string, overrides: BarStateOverrides): string {
  const params = new URLSearchParams();
  if (overrides.query) params.set("q", overrides.query);
  if (overrides.preset) {
    params.set("preset", overrides.preset);
  } else if (overrides.timeFrom !== void 0 && overrides.timeTo !== void 0) {
    params.set("from", String(overrides.timeFrom));
    params.set("to", String(overrides.timeTo));
  }
  for (const key of Object.keys(overrides.runs ?? {}).toSorted()) {
    params.append(RUN_PARAM, `${key}:${overrides.runs?.[key] ?? ""}`);
  }
  const encodedLens = encodeURIComponent(lensId);
  const paramStr = params.toString();
  return paramStr ? `${encodedLens}?${paramStr}` : encodedLens;
}

export function isOverridesEmpty(overrides: BarStateOverrides): boolean {
  return Object.keys(overrides).length === 0;
}
