import { Box, Button, Heading, HStack, Spacer, Text } from "@chakra-ui/react";
import { LuArrowRight, LuSparkles } from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { analyticsMetrics } from "~/server/analytics/registry";
import { CustomGraph, type CustomGraphInput } from "../analytics/CustomGraph";
import { usePeriodSelector } from "../PeriodSelector";
import { Link } from "../ui/link";
import { HomeCard } from "./HomeCard";

/**
 * TracesOverview
 * Shows a summary of traces performance metrics on the home page, labelled
 * with the time window the numbers cover — an unlabelled delta is noise.
 */
export function TracesOverview() {
  const { project, hasPermission } = useOrganizationTeamProject();
  const canViewCost = hasPermission("cost:view");
  const { daysDifference } = usePeriodSelector();

  const tracesOverviewGraph: CustomGraphInput = {
    graphId: "tracesOverview",
    graphType: "summary",
    series: [
      {
        name: "Traces",
        metric: "metadata.trace_id",
        aggregation: "cardinality",
        colorSet: analyticsMetrics.metadata.trace_id.colorSet,
      },
      {
        name: "Threads",
        metric: "metadata.thread_id",
        aggregation: "cardinality",
        colorSet: analyticsMetrics.metadata.thread_id.colorSet,
      },
      {
        name: "Users",
        metric: "metadata.user_id",
        aggregation: "cardinality",
        colorSet: analyticsMetrics.metadata.user_id.colorSet,
      },
      {
        name: "Total Tokens",
        metric: "performance.total_tokens",
        aggregation: "sum",
        colorSet: analyticsMetrics.performance.total_tokens.colorSet,
      },
      ...(canViewCost
        ? [
            {
              name: "LLM Cost",
              metric: "performance.total_cost" as const,
              aggregation: "sum" as const,
              colorSet: analyticsMetrics.performance.total_cost.colorSet,
            },
          ]
        : []),
      {
        name: "Mean Completion Time",
        metric: "performance.completion_time",
        aggregation: "avg",
        colorSet: analyticsMetrics.performance.completion_time.colorSet,
      },
    ],
    includePrevious: true,
    timeScale: "full",
  };

  if (!project) {
    return null;
  }

  return (
    <HomeCard width="full" padding={4} _hover={{ boxShadow: "2xs" }}>
      <HStack width="full" gap={2} marginBottom={2}>
        <Heading size="sm" color="fg">
          Traces Overview
        </Heading>
        <Text fontSize="xs" color="fg.muted">
          {daysDifference === 1 ? "Last day" : `Last ${daysDifference} days`}
        </Text>
        <Spacer />
        <Link
          href={`/${project.slug}/analytics`}
          fontSize="xs"
          color="fg.muted"
          _hover={{ color: "orange.500" }}
        >
          View dashboards <LuArrowRight size={12} />
        </Link>
        <Button
          asChild
          size="xs"
          variant="subtle"
          colorPalette="purple"
          css={{
            "&:hover .investigate-icon, &:focus-visible .investigate-icon": {
              width: "13px",
              opacity: 1,
              marginLeft: "3px",
            },
          }}
        >
          <Link
            href={`/${project.slug}/langy?auto=1&prompt=${encodeURIComponent(
              "Investigate the most important signal in this project from the last 24 hours. Explain what changed, show the affected traces, and suggest the next action.",
            )}`}
          >
            Investigate signal
            <Box
              as="span"
              className="investigate-icon"
              width="0"
              opacity={0}
              overflow="hidden"
              display="inline-flex"
              transition="width 160ms ease, opacity 160ms ease, margin-left 160ms ease"
            >
              <LuSparkles size={13} />
            </Box>
          </Link>
        </Button>
      </HStack>
      <CustomGraph input={tracesOverviewGraph} />
    </HomeCard>
  );
}
