import { useDrawer } from "~/hooks/useDrawer";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import {
  useScenarioChipData,
  type ScenarioChipData,
} from "../components/TraceDrawer/ScenarioChip";
import { useFilterStore } from "../stores/filterStore";
import { parseSdkInfo, type SdkInfo } from "../utils/sdkInfo";
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
  | { kind: "service"; value: string; onFilter: () => void }
  | { kind: "origin"; value: string; onFilter: () => void }
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
  const { latestVersion, missing } = usePromptByHandle(lastUsedHandle);
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

  if (trace.serviceName) {
    chips.push({
      kind: "service",
      value: trace.serviceName,
      onFilter: addToFilter("service", trace.serviceName),
    });
  }
  chips.push({
    kind: "origin",
    value: trace.origin,
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
      selectedId: trace.selectedPromptId,
      spanId: trace.selectedPromptSpanId,
    });
  }

  if (trace.lastUsedPromptId) {
    chips.push({
      kind: "promptLastUsed",
      handle: trace.lastUsedPromptId,
      versionNumber: trace.lastUsedPromptVersionNumber,
      spanId: trace.lastUsedPromptSpanId,
      state: lastUsedState,
      driftFromSelection,
      outOfDate: isOutOfDate,
    });
  }

  return { chips, onSelectSpan, onOpenPromptsTab };
}
