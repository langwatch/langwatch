import {
  Box,
  Button,
  Grid,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuArrowRight, LuSparkles } from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { analyticsMetrics } from "~/server/analytics/registry";
import { CustomGraph, type CustomGraphInput } from "../analytics/CustomGraph";
import { usePeriodSelector } from "../PeriodSelector";
import { Link } from "../ui/link";
import { HomeCard } from "./HomeCard";

const QUICK_STARTS = [
  {
    label: "Connect tracing",
    description: "See your first live trace",
    path: "traces",
  },
  {
    label: "Create a prompt",
    description: "Version and test a prompt",
    path: "prompts",
  },
  {
    label: "Run a simulation",
    description: "Test an agent journey",
    path: "simulations",
  },
] as const;

function NewProjectQuickView({ projectSlug }: { projectSlug: string }) {
  return (
    <VStack align="stretch" gap={3} paddingY={3} width="full">
      <HStack
        align={{ base: "start", md: "center" }}
        justify="space-between"
        flexDirection={{ base: "column", md: "row" }}
        gap={1}
      >
        <Text fontSize="sm" fontWeight="medium" color="fg">
          Nothing here yet — pick a quick start
        </Text>
        <Text fontSize="xs" color="fg.muted">
          These are good first ways to explore LangWatch.
        </Text>
      </HStack>
      <Grid
        templateColumns={{ base: "1fr", sm: "repeat(3, minmax(0, 1fr))" }}
        gap={2}
      >
        {QUICK_STARTS.map((item) => (
          <Link
            key={item.path}
            href={`/${projectSlug}/${item.path}`}
            display="block"
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="lg"
            paddingX={3}
            paddingY={2.5}
            color="fg"
            textDecoration="none"
            transition="border-color 130ms ease, background 130ms ease"
            _hover={{
              borderColor: "orange.emphasized",
              background: "bg.subtle",
              textDecoration: "none",
            }}
          >
            <HStack justify="space-between" gap={2}>
              <VStack align="start" gap={0} minWidth={0}>
                <Text fontSize="xs" fontWeight="semibold">
                  {item.label}
                </Text>
                <Text fontSize="2xs" color="fg.muted" lineClamp={1}>
                  {item.description}
                </Text>
              </VStack>
              <LuArrowRight size={13} aria-hidden />
            </HStack>
          </Link>
        ))}
      </Grid>
    </VStack>
  );
}

/**
 * TracesOverview
 * Shows a summary of traces performance metrics on the home page, labelled
 * with the time window the numbers cover — an unlabelled delta is noise.
 */
export function TracesOverview({
  showInvestigateSignal = false,
}: {
  showInvestigateSignal?: boolean;
}) {
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
        {showInvestigateSignal ? (
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
        ) : null}
      </HStack>
      <CustomGraph
        input={tracesOverviewGraph}
        emptyState={<NewProjectQuickView projectSlug={project.slug} />}
      />
    </HomeCard>
  );
}
