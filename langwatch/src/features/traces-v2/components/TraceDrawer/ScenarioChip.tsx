import { Circle, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { LuCheck, LuX } from "react-icons/lu";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/components/simulations/scenario-run-status-config";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { ChipDef } from "./ChipBar";

/**
 * Returns a ChipDef for the trace's scenario run, or null when the trace
 * isn't part of a scenario. Clicking the chip opens the scenario run
 * drawer directly — preview info (status, criteria, reasoning) lives in
 * the hover tooltip so the chip doubles as a navigation link.
 */
export function useScenarioChipDef(
  scenarioRunId: string | null | undefined,
): ChipDef | null {
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

  const status = data?.status;
  const statusConfig = status ? SCENARIO_RUN_STATUS_CONFIG[status] : undefined;
  const dotColor = statusConfig?.fgColor ?? "fg.subtle";

  const metCount = data?.results?.metCriteria?.length ?? 0;
  const unmetCount = data?.results?.unmetCriteria?.length ?? 0;
  const totalCount = metCount + unmetCount;
  const hasResults = !!data?.results && totalCount > 0;

  const displayName =
    data?.name ?? (isLoading ? "loading…" : `run ${scenarioRunId.slice(0, 8)}`);

  const openScenarioDrawer = () => {
    openDrawer("scenarioRunDetail", {
      urlParams: { scenarioRunId },
    });
  };

  return {
    id: `scenario:${scenarioRunId}`,
    label: "Scenario",
    value: hasResults
      ? `${displayName} · ${metCount}/${totalCount}`
      : displayName,
    dot: dotColor,
    tone: "purple",
    onClick: openScenarioDrawer,
    tooltip: (
      <VStack align="stretch" gap={1.5} minWidth="240px" maxWidth="320px">
        <HStack gap={2}>
          <Circle size="8px" bg={dotColor} flexShrink={0} />
          <Text textStyle="sm" fontWeight="semibold" truncate>
            {data?.name ?? "Untitled scenario"}
          </Text>
        </HStack>
        {statusConfig && (
          <Text textStyle="xs" color="fg.muted" textTransform="capitalize">
            {statusConfig.label}
            {hasResults && ` · ${metCount}/${totalCount} criteria met`}
            {data?.durationInMs != null &&
              ` · ${(data.durationInMs / 1000).toFixed(1)}s`}
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
            {data?.results?.metCriteria?.slice(0, 3).map((c, i) => (
              <CriterionRow key={`met-${i}`} text={c} met />
            ))}
            {data?.results?.unmetCriteria?.slice(0, 3).map((c, i) => (
              <CriterionRow key={`unmet-${i}`} text={c} met={false} />
            ))}
            {totalCount > 6 && (
              <Text textStyle="2xs" color="fg.subtle">
                +{totalCount - 6} more
              </Text>
            )}
          </VStack>
        )}
        {data?.results?.reasoning && (
          <Text
            textStyle="2xs"
            color="fg.muted"
            lineClamp={3}
            paddingTop={1}
            borderTopWidth="1px"
            borderColor="border.muted"
          >
            {data.results.reasoning}
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
    ariaLabel: `Open scenario run ${data?.name ?? scenarioRunId}`,
  };
}

function CriterionRow({ text, met }: { text: string; met: boolean }) {
  return (
    <HStack gap={2} align="flex-start">
      <Icon
        as={met ? LuCheck : LuX}
        boxSize={3}
        color={met ? "green.500" : "red.500"}
        marginTop="3px"
        flexShrink={0}
      />
      <Text textStyle="2xs" color="fg" lineClamp={2}>
        {text}
      </Text>
    </HStack>
  );
}
