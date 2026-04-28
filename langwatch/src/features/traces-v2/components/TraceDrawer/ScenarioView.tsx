import {
  Box,
  Circle,
  HStack,
  Icon,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuCheck, LuExternalLink, LuFilter, LuX } from "react-icons/lu";
import { ScenarioMessageRenderer } from "~/components/simulations/ScenarioMessageRenderer";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/components/simulations/scenario-run-status-config";
import { useFilterStore } from "~/features/traces-v2/stores/filterStore";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

interface ScenarioViewProps {
  scenarioRunId: string;
}

export function ScenarioView({ scenarioRunId }: ScenarioViewProps) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const toggleFacet = useFilterStore((s) => s.toggleFacet);

  const { data, isLoading, error } = api.scenarios.getRunState.useQuery(
    {
      scenarioRunId,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !!scenarioRunId,
      refetchInterval: 3000,
    },
  );

  if (isLoading && !data) {
    return (
      <VStack align="stretch" gap={3} padding={6}>
        <Skeleton height="20px" width="40%" />
        <Skeleton height="14px" width="60%" />
        <Skeleton height="120px" width="100%" />
      </VStack>
    );
  }

  if (error || !data) {
    return (
      <VStack align="stretch" gap={2} padding={6}>
        <Text textStyle="sm" fontWeight="semibold">
          Scenario run unavailable
        </Text>
        <Text textStyle="xs" color="fg.muted">
          {error?.message ?? "This run may have been deleted."}
        </Text>
      </VStack>
    );
  }

  const statusConfig = SCENARIO_RUN_STATUS_CONFIG[data.status];
  const dotColor = statusConfig?.fgColor ?? "fg.subtle";
  const metCount = data.results?.metCriteria?.length ?? 0;
  const unmetCount = data.results?.unmetCriteria?.length ?? 0;
  const totalCount = metCount + unmetCount;
  const hasResults = totalCount > 0;
  const messages = data.messages ?? [];

  return (
    <VStack align="stretch" gap={0}>
      {/* Header */}
      <Box
        paddingX={4}
        paddingY={3}
        borderBottomWidth="1px"
        borderColor="border"
      >
        <HStack gap={2} marginBottom={1}>
          <Circle size="8px" bg={dotColor} flexShrink={0} />
          <Text textStyle="sm" fontWeight="semibold" truncate>
            {data.name ?? "Untitled scenario"}
          </Text>
        </HStack>
        <Text textStyle="xs" color="fg.muted" textTransform="capitalize">
          {statusConfig?.label ?? data.status}
          {hasResults && ` · ${metCount}/${totalCount} criteria met`}
          {data.durationInMs != null &&
            ` · ${(data.durationInMs / 1000).toFixed(1)}s`}
        </Text>
        <HStack gap={3} marginTop={2}>
          <ActionLink
            icon={LuFilter}
            label="Filter list"
            onClick={() => toggleFacet("scenarioRun", scenarioRunId)}
            color="purple.fg"
          />
          <ActionLink
            icon={LuExternalLink}
            label="Open run"
            onClick={() =>
              openDrawer("scenarioRunDetail", {
                urlParams: { scenarioRunId },
              })
            }
            color="blue.fg"
          />
        </HStack>
      </Box>

      {/* Criteria */}
      {hasResults && (
        <Box
          paddingX={4}
          paddingY={3}
          borderBottomWidth="1px"
          borderColor="border"
        >
          <Text
            textStyle="2xs"
            color="fg.subtle"
            fontWeight="medium"
            textTransform="uppercase"
            letterSpacing="0.04em"
            marginBottom={2}
          >
            Criteria
          </Text>
          <VStack align="stretch" gap={1.5}>
            {data.results?.metCriteria?.map((c, i) => (
              <CriterionRow key={`met-${i}`} text={c} met />
            ))}
            {data.results?.unmetCriteria?.map((c, i) => (
              <CriterionRow key={`unmet-${i}`} text={c} met={false} />
            ))}
          </VStack>
          {data.results?.reasoning && (
            <Box
              marginTop={3}
              paddingTop={3}
              borderTopWidth="1px"
              borderColor="border.muted"
            >
              <Text
                textStyle="2xs"
                color="fg.subtle"
                fontWeight="medium"
                textTransform="uppercase"
                letterSpacing="0.04em"
                marginBottom={1}
              >
                Reasoning
              </Text>
              <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
                {data.results.reasoning}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* Conversation */}
      {messages.length > 0 && (
        <Box paddingX={4} paddingY={3} bg="bg.muted">
          <Text
            textStyle="2xs"
            color="fg.subtle"
            fontWeight="medium"
            textTransform="uppercase"
            letterSpacing="0.04em"
            marginBottom={2}
          >
            Simulator transcript
          </Text>
          <Box borderRadius="md" overflow="hidden" bg="bg.panel">
            <ScenarioMessageRenderer messages={messages} variant="drawer" />
          </Box>
        </Box>
      )}
    </VStack>
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

function ActionLink({
  icon: IconComp,
  label,
  onClick,
  color,
}: {
  icon: typeof LuFilter;
  label: string;
  onClick: () => void;
  color: string;
}) {
  return (
    <Box
      as="button"
      onClick={onClick}
      cursor="pointer"
      _hover={{ textDecoration: "underline" }}
    >
      <HStack gap={1} as="span">
        <Icon as={IconComp} boxSize={3} color={color} />
        <Text textStyle="xs" color={color} fontWeight="medium">
          {label}
        </Text>
      </HStack>
    </Box>
  );
}
