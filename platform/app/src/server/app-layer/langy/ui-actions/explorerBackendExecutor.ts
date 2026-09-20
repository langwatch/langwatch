import {
  EXPLORER_ACTIONS,
  type ExplorerActionKind,
} from "~/features/traces-v2/actions/manifest";
import {
  type ExplorerState,
  isExplorerTransformError,
} from "~/features/traces-v2/actions/transforms/types";
import { getPresetById } from "~/features/traces-v2/utils/timeRangePresets";
import {
  buildFragment,
  computeOverrides,
} from "~/features/traces-v2/utils/urlState";
import { LangyUiHandlerFailedError, LangyUiNoBrowserError } from "./errors";

/**
 * The away half of the Explorer's actions.
 *
 * The Explorer keeps no saved document: its state is the URL. So with no page
 * open, an action that changes what is searched has nothing to write to. It
 * runs the same pure transform over the Explorer's defaults and answers the
 * link that opens the Explorer in that state, which the card renders as
 * "View in Trace Explorer". A read answers those defaults, marked as not read
 * from a page. An action that only means something on an open page (a
 * selection, a page number, a run with its progress bar) is refused for lack
 * of a browser, the same answer every page-only kind gives.
 */

const DEFAULT_LENS_ID = "all-traces";
const DEFAULT_PRESET_ID = "30d";

/** The label the card puts on the link an away action answers. */
export const EXPLORER_LINK_LABEL = "View in Trace Explorer";

export function defaultExplorerState(): ExplorerState {
  const preset = getPresetById(DEFAULT_PRESET_ID);
  const now = Date.now();
  const window = preset?.compute() ?? {
    from: now - 30 * 24 * 3_600_000,
    to: now,
  };
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
export function explorerHrefFor({
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

function savedRead({ projectSlug }: { projectSlug: string }) {
  const state = defaultExplorerState();
  return {
    source: "saved" as const,
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

export function isExplorerActionKindOnBackend(
  kind: string,
): kind is ExplorerActionKind {
  return Object.hasOwn(EXPLORER_ACTIONS, kind);
}

export function executeExplorerBackendAction({
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
  if (definition.away === "saved") return savedRead({ projectSlug });

  const transform =
    "explorerTransform" in definition ? definition.explorerTransform : null;
  if (!transform) throw new LangyUiHandlerFailedError(kind);
  try {
    const applied = transform({
      state: defaultExplorerState(),
      payload: payload as never,
    });
    return {
      ...(applied.result ?? {}),
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
