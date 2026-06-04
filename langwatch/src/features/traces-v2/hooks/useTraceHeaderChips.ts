import { useDrawer } from "~/hooks/useDrawer";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import {
  type ScenarioChipData,
  useScenarioChipData,
} from "../components/TraceDrawer/ScenarioChip";
import { useDrawerStore } from "../stores/drawerStore";
import { useFilterStore } from "../stores/filterStore";
import { useFocusSectionStore } from "../stores/focusSectionStore";
import { parseSdkInfo, type SdkInfo } from "../utils/sdkInfo";
import { type RichEval, useTraceEvaluations } from "./useTraceEvaluations";
import { usePromptByHandle } from "./usePromptByHandle";

export interface SdkInfoLike {
  shortLabel: string;
  longLabel: string;
  description: string;
  rawName: string;
  version?: string | null;
  language: string;
  family?: string | null;
  scenario?: { version?: string | null } | null;
}

export interface PromptChipState {
  /** Latest version number from the live prompt config. Null when the lookup
   * hasn't completed or the prompt no longer exists in the project. */
  latestVersion: number | null;
  /** True when the looked-up handle returned no row — the prompt was deleted
   * or never existed in this project. */
  missing: boolean;
}

/** Discriminated chip data used by `<TraceHeaderChips>` to render JSX. */
export type TraceHeaderChipData =
  | {
      kind: "service";
      service: string;
      onFilter: () => void;
    }
  | {
      kind: "origin";
      origin: string;
      onFilter: () => void;
    }
  | { kind: "scenario"; data: ScenarioChipData }
  | { kind: "sdk"; sdk: SdkInfoLike }
  | {
      kind: "promptSelected";
      selectedId: string;
      spanId: string | null;
    }
  | {
      kind: "promptLastUsed";
      handle: string;
      versionNumber: number | null;
      spanId: string | null;
      state: PromptChipState;
      driftFromSelection: boolean;
      outOfDate: boolean;
    }
  | {
      kind: "eval";
      eval: RichEval;
      onClick: () => void;
    };

interface UseTraceHeaderChipsOptions {
  onSelectSpan: (spanId: string) => void;
  onOpenPromptsTab: () => void;
}

/**
 * Pure data hook for the trace-drawer header chip strip.
 *
 * Returns structured chip data plus the click/filter handlers it needs to
 * close over. JSX rendering lives in `<TraceHeaderChips>` — this hook never
 * returns React nodes (CLAUDE.md: "Hooks return state and callbacks, never
 * JSX"). Use `.ts` here, not `.tsx`.
 */
export function useTraceHeaderChips(
  trace: TraceHeader,
  { onSelectSpan, onOpenPromptsTab }: UseTraceHeaderChipsOptions,
): {
  chips: TraceHeaderChipData[];
  onSelectSpan: (spanId: string) => void;
  onOpenPromptsTab: () => void;
} {
  const toggleFacet = useFilterStore((s) => s.toggleFacet);
  const { closeDrawer } = useDrawer();

  const addToFilter = (field: string, value: string) => () => {
    toggleFacet(field, value);
    closeDrawer();
  };

  const scenarioRunId =
    trace.scenarioRunId ?? trace.attributes["scenario.run_id"] ?? null;
  const scenarioData = useScenarioChipData(scenarioRunId);

  const sdkInfo: SdkInfo | null = parseSdkInfo({
    name: trace.attributes["sdk.name"],
    version: trace.attributes["sdk.version"],
    language: trace.attributes["sdk.language"],
    scenarioSdkName: trace.attributes["scenario.sdk.name"],
    scenarioSdkVersion: trace.attributes["scenario.sdk.version"],
    scenarioActive: !!scenarioRunId,
  });

  const lastUsedHandle = trace.lastUsedPromptId;
  const { latestVersion, missing, resolvedHandle: lastUsedResolvedHandle } =
    usePromptByHandle(lastUsedHandle);
  // SDKs sometimes emit the opaque slug-id (`prompt_xxx`) instead of the
  // human handle (`pizza-prompt`). When the live prompt config resolves a
  // friendlier handle, prefer it in the chip — fall back to the raw id so
  // we still surface *something* while the lookup is in flight or for
  // unmanaged prompts.
  const lastUsedDisplayHandle = lastUsedResolvedHandle ?? lastUsedHandle;
  const { resolvedHandle: selectedResolvedHandle } = usePromptByHandle(
    trace.selectedPromptId,
  );
  const selectedDisplayId = selectedResolvedHandle ?? trace.selectedPromptId;
  const lastUsedState: PromptChipState = { latestVersion, missing };

  const driftFromSelection =
    !!trace.selectedPromptId &&
    !!trace.lastUsedPromptId &&
    trace.selectedPromptId !== trace.lastUsedPromptId;

  const isOutOfDate =
    !!trace.lastUsedPromptVersionNumber &&
    !!lastUsedState.latestVersion &&
    lastUsedState.latestVersion > trace.lastUsedPromptVersionNumber;

  const chips: TraceHeaderChipData[] = [];

  // Service and origin are answer different questions — service is the app
  // that produced the trace, origin is where the SDK call entered the system
  // (web, batch import, replay, …) — so they get their own chips.
  if (trace.serviceName) {
    chips.push({
      kind: "service",
      service: trace.serviceName,
      onFilter: addToFilter("service", trace.serviceName),
    });
  }
  chips.push({
    kind: "origin",
    origin: trace.origin,
    onFilter: addToFilter("origin", trace.origin),
  });
  if (scenarioData) {
    chips.push({ kind: "scenario", data: scenarioData });
  }
  if (sdkInfo) {
    chips.push({ kind: "sdk", sdk: sdkInfo });
  }

  // Same prompt selected and last-used — collapse into the last-used chip
  // below so the strip doesn't show two chips with the same value.
  if (trace.selectedPromptId && driftFromSelection) {
    chips.push({
      kind: "promptSelected",
      selectedId: selectedDisplayId ?? trace.selectedPromptId,
      spanId: trace.selectedPromptSpanId,
    });
  }

  if (trace.lastUsedPromptId) {
    chips.push({
      kind: "promptLastUsed",
      handle: lastUsedDisplayHandle ?? trace.lastUsedPromptId,
      versionNumber: trace.lastUsedPromptVersionNumber,
      spanId: trace.lastUsedPromptSpanId,
      state: lastUsedState,
      driftFromSelection,
      outOfDate: isOutOfDate,
    });
  }

  // One chip per evaluation result. Click jumps to the trace Summary
  // Evals accordion and scrolls it into view — operators previously had
  // to expand the drawer past the metadata strip to see any eval
  // signal, even on heavily-evaluated traces.
  const { rich: evals } = useTraceEvaluations();
  const setViewMode = useDrawerStore((s) => s.setViewMode);
  const requestFocus = useFocusSectionStore((s) => s.request);
  for (const ev of evals) {
    chips.push({
      kind: "eval",
      eval: ev,
      onClick: () => {
        // After the redesign Summary is its own DrawerViewMode, not a
        // SpanTabBar tab — jumping to the Evals accordion flips the
        // drawer mode and lets the section focus store pulse the right
        // accordion stack (TraceSummaryAccordions).
        setViewMode("summary");
        requestFocus({ traceId: trace.traceId, section: "evals" });
      },
    });
  }

  return { chips, onSelectSpan, onOpenPromptsTab };
}
