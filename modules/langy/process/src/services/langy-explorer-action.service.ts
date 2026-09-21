import { LangyUiHandlerFailedError, LangyUiNoBrowserError } from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";
import {
  buildFragment,
  computeOverrides,
  EXPLORER_ACTIONS,
  type ExplorerActionKind,
  type ExplorerState,
  PRESETS_BY_ID,
  isExplorerTransformError,
} from "@langwatch/trace-contract";

/**
 * The away half of the Trace Explorer's actions: no saved document, so the
 * pure transform runs over the Explorer's defaults and the answer is a link.
 * @see specs/langy/langy-trace-explorer-actions.feature
 */

const DEFAULT_LENS_ID = "all-traces";
const DEFAULT_PRESET_ID = "30d";
const THIRTY_DAYS_MS = 30 * 24 * 3_600_000;

/** What a read answered from defaults says about itself. */
export const SAVED_READ_NOTE =
  "No open Trace Explorer page answered. These are the Explorer's defaults, not what is on the user's screen: do not report them as the user's filter, window or count. Open the Explorer with `langwatch navigate open traces` and read the state again.";

/** The label the card puts on the link an away action answers. */
export const EXPLORER_LINK_LABEL = "View in Trace Explorer";

export class LangyExplorerActionService {
  static create(): LangyExplorerActionService {
    return new LangyExplorerActionService();
  }

  private constructor() {}

  /** Whether this kind belongs to the Explorer's manifest. */
  isExplorerKind(kind: string): kind is ExplorerActionKind {
    return Object.hasOwn(EXPLORER_ACTIONS, kind);
  }

  /** Runs one Explorer action with no page open, answering a link or a read. */
  run({
    projectSlug,
    kind,
    payload,
  }: {
    projectSlug: string;
    kind: ExplorerActionKind;
    payload: unknown;
  }): unknown {
    const definition = EXPLORER_ACTIONS[kind];
    if (definition.away === "none") throw new LangyUiNoBrowserError(kind);
    if (definition.away === "saved") return this.savedRead({ projectSlug });

    const transform = "explorerTransform" in definition ? definition.explorerTransform : null;
    if (!transform) throw new LangyUiHandlerFailedError(kind);

    try {
      const applied = transform({
        state: defaultExplorerState(),
        payload: payload as never,
      });
      return {
        ...asRecord(applied.result),
        href: explorerHrefFor({ projectSlug, state: applied.state }),
        label: EXPLORER_LINK_LABEL,
      };
    } catch (error) {
      if (isExplorerTransformError(error)) {
        throw new LangyUiHandlerFailedError(kind, error.code);
      }
      throw error;
    }
  }

  private savedRead({ projectSlug }: { projectSlug: string }) {
    const state = defaultExplorerState();
    return {
      source: "saved" as const,
      // Read by the agent: without it a saved read looks like a page showing
      // no filter and 30 days, and the agent reports that as the user's screen.
      note: SAVED_READ_NOTE,
      query: state.queryText,
      timeRange: {
        from: state.timeRange.from,
        to: state.timeRange.to,
        presetId: state.timeRange.presetId,
        label: state.timeRange.label,
      },
      lens: { id: state.activeLensId },
      sort: state.sort,
      grouping: state.grouping,
      page: state.page,
      pageSize: state.pageSize,
      // No page answered, so no list was read: the count is the page's to give.
      totalHits: null,
      pageTraceIds: [],
      href: explorerHrefFor({ projectSlug, state }),
      label: EXPLORER_LINK_LABEL,
    };
  }
}

/** The Explorer as it opens with nothing searched. */
function defaultExplorerState(): ExplorerState {
  const preset = PRESETS_BY_ID[DEFAULT_PRESET_ID];
  const now = nowInstant().epochMilliseconds;
  const window = preset?.compute() ?? { from: now - THIRTY_DAYS_MS, to: now };
  return {
    queryText: "",
    timeRange: {
      ...window,
      label: preset?.label ?? "Last 30 days",
      presetId: DEFAULT_PRESET_ID,
    },
    activeLensId: DEFAULT_LENS_ID,
    sort: { columnId: "time", direction: "desc" },
    grouping: "flat",
    columnOrder: [],
    page: 1,
    pageSize: 50,
    selection: { mode: "explicit", traceIds: new Set<string>() },
    expandedRows: new Set<string>(),
    evalRuns: {},
  };
}

/** The Explorer's own address for a state, the fragment `useURLSync` reads. */
function explorerHrefFor({
  projectSlug,
  state,
}: {
  projectSlug: string;
  state: Pick<ExplorerState, "activeLensId" | "queryText" | "timeRange">;
}): string {
  const fragment = buildFragment(
    state.activeLensId,
    computeOverrides({
      query: state.queryText,
      timeRange: state.timeRange,
      defaultPresetId: DEFAULT_PRESET_ID,
    }),
  );
  return `/${projectSlug}/traces#${fragment}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
