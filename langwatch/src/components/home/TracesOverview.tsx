import {
  Box,
  chakra,
  Grid,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import {
  LuArrowRight,
  LuChevronDown,
  LuChevronRight,
} from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { analyticsMetrics } from "~/server/analytics/registry";
import { CustomGraph, type CustomGraphInput } from "../analytics/CustomGraph";
import { usePeriodSelector } from "../PeriodSelector";
import { Link } from "../ui/link";
import { HomeCard } from "./HomeCard";
import {
  HOME_SECTION_PADDING,
  HomeSectionHeader,
} from "./HomeSectionHeader";

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
/**
 * How the overview presents itself.
 *
 * `full` is the page-wide card the classic home has always had. The other two
 * are the Langy home's, and they answer the same question differently:
 *
 *   - `strip`   the figures alone, with the chart one labelled click away. The
 *               lit block above wants the fold, and a reader glancing at
 *               "how is my project doing" is answered by the figures and their
 *               deltas without a curve.
 *   - `trend`   the figures with a short curve under them, always visible. For
 *               the reader whose question is really "and which way is it
 *               going", where making them click is making them ask twice.
 *
 * Both are offered rather than one being declared correct, because which is
 * right depends on how the reader uses the page. The dev state switcher flips
 * between them.
 */
export type TracesOverviewVariant = "full" | "strip" | "trend";

/**
 * How many daily readings a curve needs before it is telling the truth.
 *
 * One point is a dot. Two is a slope with no evidence behind it, and a slope
 * is exactly what a reader takes away from a chart, so a two-point line is
 * worse than no line: it manufactures a direction out of a single change that
 * might be a weekday. Four readings is the first window where a curve shows
 * shape rather than noise, so below that the figures carry it alone and the
 * card offers the thing that would actually help, which is a wider window.
 */
const MIN_POINTS_FOR_A_TREND = 4;

/** What "wide enough to compare" resolves to when the reader takes the offer. */
const WIDER_WINDOW = { key: "30d", label: "Last 30 days" } as const;

export function TracesOverview({
  variant = "full",
}: {
  /** See `TracesOverviewVariant`. Nothing is ever removed, only re-presented. */
  variant?: TracesOverviewVariant;
}) {
  const { project, hasPermission } = useOrganizationTeamProject();
  const canViewCost = hasPermission("cost:view");
  const { daysDifference, setRelativePeriod } = usePeriodSelector();
  const [chartOpen, setChartOpen] = useState(false);

  const compact = variant !== "full";
  // Two forms of one fact: the chip above the figures, and the same window
  // read as part of a sentence in the control that opens the trend.
  const periodLabel =
    daysDifference === 1 ? "Last day" : `Last ${daysDifference} days`;
  const periodPhrase =
    daysDifference === 1 ? "the last day" : `the last ${daysDifference} days`;
  // The window is bucketed daily for the curve, so its length IS the number of
  // readings the curve would be drawn through.
  const trendIsMeaningful = daysDifference >= MIN_POINTS_FOR_A_TREND;
  const showTrend =
    trendIsMeaningful &&
    (variant === "trend" || (variant === "strip" && chartOpen));

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
    <HomeCard
      width="full"
      // `compact` tightens the CONTENT below, never the header: a title that
      // starts at a different inset from its neighbours is exactly the
      // inconsistency this padding constant exists to remove.
      padding={HOME_SECTION_PADDING}
      _hover={{ boxShadow: "2xs" }}
    >
      <HomeSectionHeader title="Traces overview" qualifier={periodLabel}>
        <HStack gap={2} align="center">
          <Link
            href={`/${project.slug}/analytics`}
            fontSize="xs"
            color="fg.muted"
            _hover={{ color: "orange.500" }}
          >
            View dashboards <LuArrowRight size={12} />
          </Link>
        </HStack>
      </HomeSectionHeader>
      <CustomGraph
        input={tracesOverviewGraph}
        emptyState={<NewProjectQuickView projectSlug={project.slug} />}
      />
      {/* The chart is never deleted, only moved. In `strip` it waits behind a
          named control that says what it will show and over what window, so
          the click is worth taking rather than a mystery chevron; in `trend`
          it is simply already there. */}
      {variant === "strip" && trendIsMeaningful ? (
        <chakra.button
          type="button"
          onClick={() => setChartOpen((open) => !open)}
          aria-expanded={chartOpen}
          display="inline-flex"
          alignSelf="flex-start"
          alignItems="center"
          gap={1}
          marginTop={1}
          fontSize="xs"
          color="fg.muted"
          background="transparent"
          borderWidth={0}
          cursor="pointer"
          _hover={{ color: "fg" }}
        >
          {chartOpen ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
          {chartOpen ? "Hide the trend" : `Show the trend over ${periodPhrase}`}
        </chakra.button>
      ) : null}
      {compact && !trendIsMeaningful ? (
        // Not enough readings to draw a shape. Rather than a chart that
        // invents one, or a dead sentence about it, say what the figures ARE
        // comparing themselves against and offer the window that would show a
        // real trend. The offer is the better thing, not the explanation.
        <HStack marginTop={1} gap={2} flexWrap="wrap">
          <Text fontSize="xs" color="fg.subtle">
            {`Each figure is compared with ${periodPhrase} before it.`}
          </Text>
          <chakra.button
            type="button"
            onClick={() => setRelativePeriod(WIDER_WINDOW.key)}
            fontSize="xs"
            color="fg.muted"
            background="transparent"
            borderWidth={0}
            cursor="pointer"
            textDecoration="underline"
            textUnderlineOffset="3px"
            _hover={{ color: "orange.fg" }}
          >
            See {WIDER_WINDOW.label.toLowerCase()}
          </chakra.button>
        </HStack>
      ) : null}
      {showTrend ? (
        <Box width="full" marginTop={1}>
          {/* Bucketed by day, not aggregated whole: the summary above is the
              one number, this is how it got there. `timeScale: 1` is also what
              makes the window's length equal the number of readings the curve
              is drawn through, which is what the threshold above counts. */}
          <CustomGraph
            input={{
              ...tracesOverviewGraph,
              graphType: "line",
              timeScale: 1,
              includePrevious: false,
            }}
            titleProps={{ fontSize: "xs", color: "fg.muted" }}
          />
        </Box>
      ) : null}
    </HomeCard>
  );
}
