import { HStack, Icon, Text, VStack } from "@chakra-ui/react";
import {
  LuBoxes,
  LuCircleDashed,
  LuCode,
  LuFileText,
  LuServer,
  LuSparkles,
  LuTriangleAlert,
} from "react-icons/lu";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { ChipDef } from "../components/TraceDrawer/ChipBar";
import { useScenarioChipDef } from "../components/TraceDrawer/ScenarioChip";
import { useFilterStore } from "../stores/filterStore";
import { parseSdkInfo } from "../utils/sdkInfo";

interface SdkInfoLike {
  shortLabel: string;
  longLabel: string;
  description: string;
  rawName: string;
  version?: string | null;
  language: string;
  family?: string | null;
  scenario?: { version?: string | null } | null;
}

function buildSdkChip(sdk: SdkInfoLike | null): ChipDef | null {
  if (!sdk) return null;
  return {
    id: "sdk",
    label: "SDK",
    value: sdk.shortLabel,
    icon: LuCode,
    tone: "neutral",
    tooltip: (
      <VStack align="stretch" gap={1.5} minWidth="220px" maxWidth="300px">
        <Text textStyle="xs" fontWeight="semibold">
          {sdk.longLabel}
        </Text>
        <Text textStyle="2xs" color="fg.muted" lineHeight="1.4">
          {sdk.description}
        </Text>
        <VStack align="stretch" gap={0.5} paddingTop={1}>
          <SdkRow label="Library" value={sdk.rawName} />
          {sdk.version && <SdkRow label="Version" value={sdk.version} />}
          <SdkRow label="Language" value={sdk.language} />
          {sdk.family && <SdkRow label="Family" value={sdk.family} />}
          {sdk.scenario && (
            <SdkRow
              label="Scenario"
              value={sdk.scenario.version ? `SDK ${sdk.scenario.version}` : "active"}
            />
          )}
        </VStack>
      </VStack>
    ),
  };
}

interface PromptChipState {
  /** Latest version number from the live prompt config. Null when the lookup
   * hasn't completed or the prompt no longer exists in the project. */
  latestVersion: number | null;
  /** True when the looked-up handle returned no row — the prompt was deleted
   * or never existed in this project. */
  missing: boolean;
}

interface UseTraceHeaderChipsOptions {
  onSelectSpan: (spanId: string) => void;
  onOpenPromptsTab: () => void;
}

export function useTraceHeaderChips(
  trace: TraceHeader,
  { onSelectSpan, onOpenPromptsTab }: UseTraceHeaderChipsOptions,
): ChipDef[] {
  const { project } = useOrganizationTeamProject();
  const toggleFacet = useFilterStore((s) => s.toggleFacet);
  const { closeDrawer } = useDrawer();
  // "Add to filter" affordance — pins the value as a facet on the trace
  // table query and closes the drawer so the user lands on the filtered
  // result. Used by service / origin / labels chips below.
  const addToFilter = (field: string, value: string) => () => {
    toggleFacet(field, value);
    closeDrawer();
  };

  const scenarioRunId =
    trace.scenarioRunId ?? trace.attributes["scenario.run_id"] ?? null;
  const scenarioChip = useScenarioChipDef(scenarioRunId);

  const sdkInfo = parseSdkInfo({
    name: trace.attributes["sdk.name"],
    version: trace.attributes["sdk.version"],
    language: trace.attributes["sdk.language"],
    scenarioSdkName: trace.attributes["scenario.sdk.name"],
    scenarioSdkVersion: trace.attributes["scenario.sdk.version"],
    scenarioActive: !!scenarioRunId,
  });
  const sdkChip = buildSdkChip(sdkInfo);

  // Live lookup of the prompt's *current* latest version. Only fires when
  // the trace recorded a last-used prompt — older traces without the
  // PRD-023 projection never trigger the request. Failure (NOT_FOUND
  // mapped to error) is treated as "prompt was deleted" via the
  // `missing` flag so the chip can show that state honestly.
  const lastUsedHandle = trace.lastUsedPromptId;
  const lookup = api.prompts.getByIdOrHandle.useQuery(
    {
      idOrHandle: lastUsedHandle ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !!lastUsedHandle,
      staleTime: 60_000,
      retry: false,
    },
  );

  const lastUsedState: PromptChipState = {
    latestVersion: lookup.data?.version ?? null,
    missing: !!lastUsedHandle && lookup.isError,
  };

  const driftFromSelection =
    !!trace.selectedPromptId &&
    !!trace.lastUsedPromptId &&
    trace.selectedPromptId !== trace.lastUsedPromptId;

  const isOutOfDate =
    !!trace.lastUsedPromptVersionNumber &&
    !!lastUsedState.latestVersion &&
    lastUsedState.latestVersion > trace.lastUsedPromptVersionNumber;

  const promptChips: ChipDef[] = [];

  if (trace.selectedPromptId && !driftFromSelection) {
    // Same as last-used — collapse into one chip representing both. The
    // last-used branch below handles rendering for this case.
  } else if (trace.selectedPromptId) {
    promptChips.push(
      buildSelectedChip(trace.selectedPromptId, trace.selectedPromptSpanId, onSelectSpan),
    );
  }

  if (trace.lastUsedPromptId) {
    promptChips.push(
      buildLastUsedChip({
        handle: trace.lastUsedPromptId,
        versionNumber: trace.lastUsedPromptVersionNumber,
        spanId: trace.lastUsedPromptSpanId,
        state: lastUsedState,
        driftFromSelection,
        outOfDate: isOutOfDate,
        onSelectSpan,
        onOpenPromptsTab,
      }),
    );
  }

  const chips: Array<ChipDef | null> = [
    trace.serviceName
      ? {
          id: "service",
          label: "Service",
          value: trace.serviceName,
          icon: LuServer,
          tone: "neutral",
          priority: 0,
          onFilter: addToFilter("service", trace.serviceName),
          filterLabel: `Filter the trace table by service ${trace.serviceName}`,
        }
      : null,
    {
      id: "origin",
      label: "Origin",
      value: trace.origin,
      icon: LuBoxes,
      tone: "neutral",
      priority: 1,
      onFilter: addToFilter("origin", trace.origin),
      filterLabel: `Filter the trace table by origin ${trace.origin}`,
    },
    scenarioChip ? { ...scenarioChip, priority: 2 } : null,
    sdkChip ? { ...sdkChip, priority: 3 } : null,
    ...promptChips.map((c, idx) => ({ ...c, priority: 4 + idx })),
  ];

  return chips.filter((c): c is ChipDef => c != null);
}

function buildSelectedChip(
  selectedId: string,
  spanId: string | null,
  onSelectSpan: (spanId: string) => void,
): ChipDef {
  return {
    id: `prompt-selected:${selectedId}`,
    label: "Selected",
    value: selectedId,
    icon: LuFileText,
    tone: "blue",
    onClick: spanId ? () => onSelectSpan(spanId) : undefined,
    tooltip: (
      <VStack align="stretch" gap={1} minWidth="220px" maxWidth="300px">
        <Text textStyle="sm" fontWeight="semibold" fontFamily="mono">
          {selectedId}
        </Text>
        <Text textStyle="2xs" color="fg.muted">
          Pin set on the span. Resolved to a different concrete prompt at
          runtime — see the &ldquo;last used&rdquo; chip for what actually ran.
        </Text>
      </VStack>
    ),
    ariaLabel: `Selected prompt ${selectedId}`,
  };
}

function buildLastUsedChip({
  handle,
  versionNumber,
  spanId,
  state,
  driftFromSelection,
  outOfDate,
  onSelectSpan,
  onOpenPromptsTab,
}: {
  handle: string;
  versionNumber: number | null;
  spanId: string | null;
  state: PromptChipState;
  driftFromSelection: boolean;
  outOfDate: boolean;
  onSelectSpan: (spanId: string) => void;
  onOpenPromptsTab: () => void;
}): ChipDef {
  const value = versionNumber != null ? `${handle} v${versionNumber}` : handle;
  const tone: "blue" | "yellow" | "neutral" = state.missing
    ? "neutral"
    : driftFromSelection || outOfDate
      ? "yellow"
      : "blue";
  const icon = state.missing
    ? LuCircleDashed
    : driftFromSelection || outOfDate
      ? LuTriangleAlert
      : LuFileText;

  const onClick = () => {
    if (spanId) {
      onSelectSpan(spanId);
    } else {
      onOpenPromptsTab();
    }
  };

  return {
    id: `prompt-last-used:${handle}:${versionNumber ?? ""}`,
    label: driftFromSelection ? "Last used" : "Prompt",
    value,
    icon,
    dot: state.missing ? undefined : "purple.solid",
    tone,
    onClick,
    tooltip: (
      <VStack align="stretch" gap={1.5} minWidth="240px" maxWidth="320px">
        <HStack gap={2}>
          <Text textStyle="sm" fontWeight="semibold" fontFamily="mono">
            {handle}
          </Text>
          {versionNumber != null && (
            <Text textStyle="xs" color="fg.muted" fontFamily="mono">
              v{versionNumber}
            </Text>
          )}
        </HStack>
        {state.missing ? (
          <Text textStyle="2xs" color="fg.muted">
            Prompt no longer exists in this project. The trace still shows
            what ran at the time.
          </Text>
        ) : (
          <HStack gap={1}>
            <Icon as={LuSparkles} boxSize={3} color="purple.fg" />
            <Text textStyle="2xs" color="purple.fg" fontWeight="medium">
              Latest run on this trace
            </Text>
          </HStack>
        )}
        {outOfDate && state.latestVersion != null && (
          <HStack
            gap={1.5}
            paddingTop={1.5}
            borderTopWidth="1px"
            borderColor="border.muted"
          >
            <Icon as={LuTriangleAlert} boxSize={3} color="yellow.fg" />
            <Text textStyle="2xs" color="yellow.fg">
              Out of date — current latest is v{state.latestVersion}.
            </Text>
          </HStack>
        )}
        {driftFromSelection && (
          <HStack
            gap={1.5}
            paddingTop={1.5}
            borderTopWidth="1px"
            borderColor="border.muted"
          >
            <Icon as={LuTriangleAlert} boxSize={3} color="yellow.fg" />
            <Text textStyle="2xs" color="yellow.fg">
              Pinned prompt resolved to a different concrete prompt at runtime.
            </Text>
          </HStack>
        )}
        <Text
          textStyle="2xs"
          color="fg.subtle"
          paddingTop={1}
          borderTopWidth="1px"
          borderColor="border.muted"
        >
          {spanId
            ? "Click to jump to the span that ran this prompt"
            : "Click to open the Prompts tab"}
        </Text>
      </VStack>
    ),
    ariaLabel: spanId
      ? `Jump to the span that ran prompt ${handle}`
      : `Open prompt ${handle} in the Prompts tab`,
  };
}

function SdkRow({ label, value }: { label: string; value: string }) {
  return (
    <HStack justify="space-between" gap={4} align="flex-start" minWidth={0}>
      <Text textStyle="xs" color="fg.muted" flexShrink={0}>
        {label}
      </Text>
      <Text
        textStyle="xs"
        fontFamily="mono"
        color="fg"
        textAlign="right"
        wordBreak="break-all"
        whiteSpace="nowrap"
        textOverflow="ellipsis"
        overflow="hidden"
      >
        {value}
      </Text>
    </HStack>
  );
}
