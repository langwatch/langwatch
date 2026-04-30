import {
  Box,
  Button,
  Flex,
  Heading,
  HStack,
  Stack,
  Text,
} from "@chakra-ui/react";
import type React from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useProjectHasTraces } from "../../hooks/useProjectHasTraces";
import type { TimeRange } from "../../stores/filterStore";
import { useFilterStore } from "../../stores/filterStore";
import { useOnboardingStore } from "../../onboarding/store/onboardingStore";
import { useViewStore } from "../../stores/viewStore";

const LangWatchMark: React.FC = () => (
  <Box
    color="fg.muted"
    opacity={0.55}
    css={{ filter: "grayscale(1)" }}
    aria-hidden="true"
  >
    <svg
      width="44"
      height="60"
      viewBox="0 0 38 52"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M0 12.383V41.035C0 41.392 0.190002 41.723 0.500002 41.901L17.095 51.481C17.25 51.571 17.422 51.616 17.595 51.616C17.768 51.616 17.94 51.571 18.095 51.481L37.279 40.409C37.589 40.23 37.779 39.9 37.779 39.543V10.887C37.779 10.53 37.589 10.199 37.279 10.021L31.168 6.49498C31.014 6.40598 30.841 6.36098 30.669 6.36098C30.496 6.36098 30.323 6.40498 30.169 6.49498L27.295 8.15398V4.83698C27.295 4.47998 27.105 4.14898 26.795 3.97098L20.684 0.441982C20.529 0.352982 20.357 0.307983 20.184 0.307983C20.011 0.307983 19.839 0.352982 19.684 0.441982L13.781 3.85098C13.471 4.02998 13.281 4.35998 13.281 4.71698V12.157L12.921 12.365V11.872C12.921 11.515 12.731 11.185 12.421 11.006L7.405 8.10698C7.25 8.01798 7.077 7.97298 6.905 7.97298C6.733 7.97298 6.56 8.01798 6.405 8.10698L0.501001 11.517C0.191001 11.695 0 12.025 0 12.383ZM1.5 13.248L5.519 15.566V23.294C5.519 23.304 5.524 23.313 5.525 23.323C5.526 23.345 5.529 23.366 5.534 23.388C5.538 23.411 5.544 23.433 5.552 23.455C5.559 23.476 5.567 23.496 5.577 23.516C5.582 23.525 5.581 23.535 5.587 23.544C5.591 23.551 5.6 23.554 5.604 23.561C5.617 23.581 5.63 23.6 5.646 23.618C5.669 23.644 5.695 23.665 5.724 23.686C5.741 23.698 5.751 23.716 5.77 23.727L11.236 26.886C11.243 26.89 11.252 26.888 11.26 26.892C11.328 26.927 11.402 26.952 11.484 26.952C11.566 26.952 11.641 26.928 11.709 26.893C11.728 26.883 11.743 26.87 11.761 26.858C11.812 26.823 11.855 26.781 11.89 26.731C11.898 26.719 11.911 26.715 11.919 26.702C11.924 26.693 11.924 26.682 11.929 26.674C11.944 26.644 11.951 26.613 11.96 26.58C11.969 26.547 11.978 26.515 11.98 26.481C11.98 26.471 11.986 26.462 11.986 26.452V20.138V19.302L17.096 22.251V49.749L1.5 40.747V13.248ZM35.778 10.887L30.879 13.718L25.768 10.766L26.544 10.317L30.668 7.93698L35.778 10.887ZM25.293 4.83598L20.391 7.66498L15.281 4.71598L20.183 1.88398L25.293 4.83598ZM10.92 11.872L6.019 14.701L2.001 12.383L6.904 9.55098L10.92 11.872ZM20.956 16.51L24.268 14.601V18.788C24.268 18.809 24.278 18.827 24.28 18.848C24.284 18.883 24.29 18.917 24.301 18.95C24.311 18.98 24.325 19.007 24.342 19.034C24.358 19.061 24.373 19.088 24.395 19.112C24.417 19.138 24.444 19.159 24.471 19.18C24.489 19.193 24.499 19.21 24.518 19.221L29.878 22.314L23.998 25.708V18.557C23.998 18.547 23.993 18.538 23.992 18.528C23.991 18.506 23.988 18.485 23.984 18.463C23.979 18.44 23.973 18.418 23.965 18.396C23.958 18.375 23.95 18.355 23.941 18.336C23.936 18.327 23.937 18.316 23.931 18.308C23.925 18.299 23.917 18.294 23.911 18.286C23.898 18.267 23.886 18.251 23.871 18.234C23.855 18.216 23.84 18.2 23.822 18.185C23.805 18.17 23.788 18.157 23.769 18.144C23.76 18.138 23.756 18.129 23.747 18.124L20.956 16.51ZM25.268 11.633L30.379 14.585V21.448L25.268 18.499V13.736V11.633ZM12.486 18.437L17.389 15.604L22.498 18.556L17.595 21.385L12.486 18.437ZM10.985 25.587L7.019 23.295L10.985 21.005V25.587ZM12.42 14.385L14.28 13.311L16.822 14.777L12.42 17.32V14.385ZM14.78 5.58198L19.891 8.53098V15.394L14.78 12.445V5.58198Z"
        fill="currentColor"
      />
    </svg>
  </Box>
);

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MINUTES_PER_HOUR = 60;

interface EmptyContent {
  title: string;
  description: string;
}

function emptyContent({
  activeLensId,
  hasFilters,
  rangeHours,
}: {
  activeLensId: string;
  hasFilters: boolean;
  rangeHours: number;
}): EmptyContent {
  if (activeLensId === "errors") {
    return {
      title: "No errors in this range",
      description:
        "Nothing failed in the selected window. Switch to All traces or widen the range to keep digging.",
    };
  }
  if (activeLensId === "conversations") {
    return {
      title: "No conversations to show",
      description:
        "Conversations group traces that share a thread. Tag spans with a thread_id to surface them here.",
    };
  }
  if (hasFilters) {
    return {
      title: "Nothing matches these filters",
      description:
        "Your query is valid, there's just nothing matching it in this window. Try widening the window, or clearing all filters.",
    };
  }
  if (rangeHours < 1) {
    const minutes = Math.round(rangeHours * MINUTES_PER_HOUR);
    return {
      title: "Quiet for the last few minutes",
      description: `The current range covers ${minutes} minute${minutes === 1 ? "" : "s"}. Try widening it.`,
    };
  }
  if (rangeHours < 24) {
    const hours = Math.round(rangeHours);
    return {
      title: "Nothing in this window",
      description: `The current range covers ${hours} hour${hours === 1 ? "" : "s"}.`,
    };
  }
  // Else branch: not errors/conversations lens, no filters, range is
  // days-or-more. The project has had traces at some point (otherwise
  // the empty-state journey would have intercepted via firstMessage=
  // false) — there just aren't any in *this* window. Action-oriented
  // copy beats the old new-user-y "Once your app starts sending
  // traces…" line, which read like the project had never seen data.
  return {
    title: "Nothing in this range",
    description:
      "Try a wider time window, or expand your query — your traces might just be outside this view.",
  };
}

interface ActionButton {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

function rangePreset(days: number, label: string): TimeRange {
  const now = Date.now();
  return {
    from: now - days * MS_PER_DAY,
    to: now,
    label,
    presetId: `${days}d`,
  };
}

export const EmptyFilterState: React.FC = () => {
  const clearAll = useFilterStore((s) => s.clearAll);
  const queryText = useFilterStore((s) => s.queryText);
  const timeRange = useFilterStore((s) => s.timeRange);
  const setTimeRange = useFilterStore((s) => s.setTimeRange);
  const activeLensId = useViewStore((s) => s.activeLensId);
  const selectLens = useViewStore((s) => s.selectLens);
  const { project } = useOrganizationTeamProject();
  const { hasAnyTraces } = useProjectHasTraces();
  const setupDismissed = !!useOnboardingStore((s) =>
    project ? s.setupDismissedByProject[project.id] : false,
  );
  const setSetupDismissedForProject = useOnboardingStore(
    (s) => s.setSetupDismissedForProject,
  );
  const resetOnboardingStage = useOnboardingStore((s) => s.reset);
  // Only offer the rewatch link in the "real, but empty" state — the
  // user dismissed the onboarding card (`setupDismissed`) and the
  // project hasn't received a real trace yet. Once any real trace
  // arrives this affordance disappears; education isn't something we
  // expect users to need, just something we leave out for the
  // genuinely curious.
  const showRewatchIntro =
    hasAnyTraces === false && setupDismissed && !!project;

  const hasFilters = queryText.trim().length > 0;
  const rangeHours = (timeRange.to - timeRange.from) / MS_PER_HOUR;
  const content = emptyContent({ activeLensId, hasFilters, rangeHours });

  const actions: ActionButton[] = [];
  if (hasFilters) {
    actions.push({ label: "Clear filters", onClick: clearAll, primary: true });
  }
  if (activeLensId !== "all-traces") {
    actions.push({
      label: "All traces",
      onClick: () => selectLens("all-traces"),
      primary: !hasFilters,
    });
  }
  if (rangeHours < 24) {
    actions.push({
      label: "Last 24 hours",
      onClick: () => setTimeRange(rangePreset(1, "Last 24 hours")),
    });
    actions.push({
      label: "Last 7 days",
      onClick: () => setTimeRange(rangePreset(7, "Last 7 days")),
    });
  } else if (rangeHours < 24 * 7) {
    actions.push({
      label: "Last 7 days",
      onClick: () => setTimeRange(rangePreset(7, "Last 7 days")),
    });
    actions.push({
      label: "Last 30 days",
      onClick: () => setTimeRange(rangePreset(30, "Last 30 days")),
    });
  }

  return (
    <Flex
      align="center"
      justify="center"
      height="full"
      paddingX={6}
      paddingY={16}
    >
      <Stack gap={6} align="center" textAlign="center" maxWidth="440px">
        <LangWatchMark />

        <Stack gap={2} align="center">
          <Heading textStyle="xl" fontWeight="semibold" color="fg">
            {content.title}
          </Heading>
          <Text textStyle="sm" color="fg.muted" lineHeight="1.7">
            {content.description}
          </Text>
        </Stack>

        {actions.length > 0 && (
          <HStack gap={2} flexWrap="wrap" justify="center">
            {actions.map((a) => (
              <Button
                key={a.label}
                size="sm"
                variant={a.primary ? "solid" : "subtle"}
                colorPalette={a.primary ? "blue" : "gray"}
                onClick={a.onClick}
              >
                {a.label}
              </Button>
            ))}
          </HStack>
        )}

        {showRewatchIntro && (
          <Button
            variant="plain"
            size="xs"
            color="fg.subtle"
            padding={0}
            minHeight="auto"
            _hover={{ color: "fg.muted" }}
            onClick={() => {
              resetOnboardingStage();
              setSetupDismissedForProject(project!.id, false);
            }}
          >
            ↻ Rewatch the intro
          </Button>
        )}
      </Stack>
    </Flex>
  );
};
