import { Circle, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { LuCheck, LuX } from "react-icons/lu";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/components/simulations/scenario-run-status-config";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { ChipDef } from "./ChipBar";

/**
 * Plain data describing the scenario run a trace belongs to. Returned by
 * `useScenarioChipData`; rendered to JSX by `buildScenarioChipDef`.
 * Splitting data from JSX keeps the hook in `.ts`-land.
 */
export interface ScenarioChipData {
  scenarioRunId: string;
  name: string | null;
  isLoading: boolean;
  status:
    | (typeof SCENARIO_RUN_STATUS_CONFIG)[keyof typeof SCENARIO_RUN_STATUS_CONFIG]
    | undefined;
  statusKey: keyof typeof SCENARIO_RUN_STATUS_CONFIG | undefined;
  durationInMs: number | null;
  metCriteria: string[];
  unmetCriteria: string[];
  reasoning: string | null;
  openScenarioDrawer: () => void;
}

/**
 * Returns scenario-chip data, or null when the trace isn't part of a
 * scenario run. Pure data — JSX is built downstream.
 */
export function useScenarioChipData(
  scenarioRunId: string | null | undefined,
): ScenarioChipData | null {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();

  const { data, isLoading } = api.scenarios.getRunState.useQuery(
    {
      scenarioRunId: scenarioRunId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !!scenarioRunId,
      staleTime: 30_000,
    },
  );

  if (!scenarioRunId) return null;

  const statusKey = data?.status;
  const status = statusKey ? SCENARIO_RUN_STATUS_CONFIG[statusKey] : undefined;

  return {
    scenarioRunId,
    name: data?.name ?? null,
    isLoading,
    status,
    statusKey,
    durationInMs: data?.durationInMs ?? null,
    metCriteria: data?.results?.metCriteria ?? [],
    unmetCriteria: data?.results?.unmetCriteria ?? [],
    reasoning: data?.results?.reasoning ?? null,
    openScenarioDrawer: () =>
      openDrawer("scenarioRunDetail", { urlParams: { scenarioRunId } }),
  };
}

/** Build a `ChipDef` (with rendered tooltip JSX) from scenario chip data. */
export function buildScenarioChipDef(d: ScenarioChipData): ChipDef {
  const dotColor = d.status?.fgColor ?? "fg.subtle";
  const metCount = d.metCriteria.length;
  const unmetCount = d.unmetCriteria.length;
  const totalCount = metCount + unmetCount;
  const hasResults = totalCount > 0;
  const displayName =
    d.name ?? (d.isLoading ? "loading…" : `run ${d.scenarioRunId.slice(0, 8)}`);

  return {
    id: `scenario:${d.scenarioRunId}`,
    label: "Scenario",
    value: hasResults
      ? `${displayName} · ${metCount}/${totalCount}`
      : displayName,
    dot: dotColor,
    tone: "purple",
    onClick: d.openScenarioDrawer,
    tooltip: (
      <VStack align="stretch" gap={1.5} minWidth="240px" maxWidth="320px">
        <HStack gap={2}>
          <Circle size="8px" bg={dotColor} flexShrink={0} />
          <Text textStyle="sm" fontWeight="semibold" truncate>
            {d.name ?? "Untitled scenario"}
          </Text>
        </HStack>
        {d.status && (
          <Text textStyle="xs" color="fg.muted" textTransform="capitalize">
            {d.status.label}
            {hasResults && ` · ${metCount}/${totalCount} criteria met`}
            {d.durationInMs != null &&
              ` · ${(d.durationInMs / 1000).toFixed(1)}s`}
          </Text>
        )}
        {hasResults && (
          <VStack
            align="stretch"
            gap={1}
            paddingTop={1.5}
            borderTopWidth="1px"
            borderColor="border.muted"
          >
            {d.metCriteria.slice(0, 3).map((c, i) => (
              <CriterionRow key={`met-${i}`} text={c} met />
            ))}
            {d.unmetCriteria.slice(0, 3).map((c, i) => (
              <CriterionRow key={`unmet-${i}`} text={c} met={false} />
            ))}
            {totalCount > 6 && (
              <Text textStyle="2xs" color="fg.subtle">
                +{totalCount - 6} more
              </Text>
            )}
          </VStack>
        )}
        {d.reasoning && (
          <Text
            textStyle="2xs"
            color="fg.muted"
            lineClamp={3}
            paddingTop={1}
            borderTopWidth="1px"
            borderColor="border.muted"
          >
            {d.reasoning}
          </Text>
        )}
        <Text
          textStyle="2xs"
          color="fg.subtle"
          paddingTop={1}
          borderTopWidth="1px"
          borderColor="border.muted"
        >
          Click to open the scenario run
        </Text>
      </VStack>
    ),
    ariaLabel: `Open scenario run ${d.name ?? d.scenarioRunId}`,
  };
}

function CriterionRow({ text, met }: { text: string; met: boolean }) {
  return (
    <HStack gap={2} align="flex-start">
      <Icon
        as={met ? LuCheck : LuX}
        boxSize={3}
        color={met ? "green.fg" : "red.fg"}
        marginTop="3px"
        flexShrink={0}
      />
      <Text textStyle="2xs" color="fg" lineClamp={2}>
        {text}
      </Text>
    </HStack>
  );
}
