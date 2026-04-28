import { Box, Circle, HStack, Icon, Skeleton, Text, VStack } from "@chakra-ui/react";
import { LuCheck, LuExternalLink, LuFilter, LuX } from "react-icons/lu";
import { Popover } from "~/components/ui/popover";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/components/simulations/scenario-run-status-config";
import { useFilterStore } from "~/features/traces-v2/stores/filterStore";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

interface ScenarioChipProps {
  scenarioRunId: string;
}

export function ScenarioChip({ scenarioRunId }: ScenarioChipProps) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const toggleFacet = useFilterStore((s) => s.toggleFacet);

  const { data, isLoading } = api.scenarios.getRunState.useQuery(
    {
      scenarioRunId,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !!scenarioRunId,
      staleTime: 30_000,
    },
  );

  const status = data?.status;
  const statusConfig = status ? SCENARIO_RUN_STATUS_CONFIG[status] : undefined;
  const dotColor = statusConfig?.fgColor ?? "fg.subtle";

  const metCount = data?.results?.metCriteria?.length ?? 0;
  const unmetCount = data?.results?.unmetCriteria?.length ?? 0;
  const totalCount = metCount + unmetCount;
  const hasResults = !!data?.results && totalCount > 0;

  const handleOpenRun = () => {
    openDrawer("scenarioRunDetail", {
      urlParams: { scenarioRunId },
    });
  };

  const handleFilterByRun = () => {
    toggleFacet("scenarioRun", scenarioRunId);
  };

  const displayName =
    data?.name ?? (isLoading ? null : `run ${scenarioRunId.slice(0, 8)}`);

  return (
    <Popover.Root positioning={{ placement: "bottom-start" }} lazyMount>
      <Popover.Trigger asChild>
        <HStack
          as="button"
          gap={1.5}
          paddingX={1.5}
          paddingY={0.5}
          borderRadius="sm"
          bg="bg.muted"
          cursor="pointer"
          _hover={{ bg: "bg.emphasized" }}
          onClick={handleOpenRun}
          aria-label="Open scenario run"
        >
          <Circle size="6px" bg={dotColor} flexShrink={0} />
          <Text textStyle="xs" color="fg.muted" fontWeight="medium">
            Scenario
          </Text>
          {isLoading && !displayName ? (
            <Skeleton height="12px" width="80px" />
          ) : (
            <Text textStyle="xs" color="fg" truncate maxWidth="160px">
              {displayName}
            </Text>
          )}
          {hasResults && (
            <Text textStyle="2xs" color="fg.muted" fontFamily="mono">
              {metCount}/{totalCount}
            </Text>
          )}
        </HStack>
      </Popover.Trigger>
      <Popover.Content width="360px">
        <Popover.Body padding={0}>
          {isLoading && !data ? (
            <VStack align="stretch" gap={2} padding={4}>
              <Skeleton height="14px" width="60%" />
              <Skeleton height="12px" width="40%" />
              <Skeleton height="48px" width="100%" />
            </VStack>
          ) : data ? (
            <VStack align="stretch" gap={0}>
              <VStack
                align="stretch"
                gap={1}
                paddingX={4}
                paddingTop={3}
                paddingBottom={3}
              >
                <HStack gap={2}>
                  <Circle size="8px" bg={dotColor} flexShrink={0} />
                  <Text textStyle="sm" fontWeight="semibold" truncate>
                    {data.name ?? "Untitled scenario"}
                  </Text>
                </HStack>
                {statusConfig && (
                  <Text textStyle="xs" color="fg.muted" textTransform="capitalize">
                    {statusConfig.label}
                    {hasResults && ` · ${metCount}/${totalCount} criteria met`}
                    {data.durationInMs != null &&
                      ` · ${(data.durationInMs / 1000).toFixed(1)}s`}
                  </Text>
                )}
                {data.results?.reasoning && (
                  <Text textStyle="xs" color="fg.muted" lineClamp={3}>
                    {data.results.reasoning}
                  </Text>
                )}
              </VStack>

              {hasResults && (
                <Box
                  borderTopWidth="1px"
                  borderColor="border"
                  paddingX={4}
                  paddingY={3}
                >
                  <VStack align="stretch" gap={1.5}>
                    {data.results?.metCriteria?.map((criterion, i) => (
                      <CriterionRow key={`met-${i}`} text={criterion} met />
                    ))}
                    {data.results?.unmetCriteria?.map((criterion, i) => (
                      <CriterionRow
                        key={`unmet-${i}`}
                        text={criterion}
                        met={false}
                      />
                    ))}
                  </VStack>
                </Box>
              )}

              <HStack
                borderTopWidth="1px"
                borderColor="border"
                paddingX={4}
                paddingY={2}
                justify="space-between"
              >
                <Box
                  as="button"
                  onClick={handleFilterByRun}
                  cursor="pointer"
                  _hover={{ textDecoration: "underline" }}
                >
                  <HStack gap={1} as="span">
                    <Icon as={LuFilter} boxSize={3} color="purple.fg" />
                    <Text
                      textStyle="xs"
                      color="purple.fg"
                      fontWeight="medium"
                    >
                      Filter list
                    </Text>
                  </HStack>
                </Box>
                <Box
                  as="button"
                  onClick={handleOpenRun}
                  cursor="pointer"
                  _hover={{ textDecoration: "underline" }}
                >
                  <HStack gap={1} as="span">
                    <Text textStyle="xs" color="blue.fg" fontWeight="medium">
                      Open run
                    </Text>
                    <Icon as={LuExternalLink} boxSize={3} color="blue.fg" />
                  </HStack>
                </Box>
              </HStack>
            </VStack>
          ) : (
            <Text textStyle="xs" color="fg.muted" padding={4}>
              Scenario run details unavailable.
            </Text>
          )}
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}

function CriterionRow({ text, met }: { text: string; met: boolean }) {
  return (
    <HStack gap={2} align="flex-start">
      <Icon
        as={met ? LuCheck : LuX}
        boxSize={3.5}
        color={met ? "green.500" : "red.500"}
        marginTop="2px"
        flexShrink={0}
      />
      <Text textStyle="xs" color="fg">
        {text}
      </Text>
    </HStack>
  );
}
