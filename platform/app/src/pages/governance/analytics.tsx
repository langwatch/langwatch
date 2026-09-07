import {
  Badge,
  Box,
  Button,
  createListCollection,
  Field,
  Heading,
  HStack,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Copy, Filter } from "lucide-react";
import { useMemo, useState } from "react";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import {
  DEFAULT_EXPLORE_SELECTION,
  DEFAULT_EXPLORE_WINDOW,
  EXPLORE_BREAKDOWNS,
  EXPLORE_INTERVALS,
  EXPLORE_MEASURES,
  EXPLORE_TEMPLATES,
  EXPLORE_WINDOWS,
  type ExploreBreakdown,
  type ExploreInterval,
  type ExploreMeasure,
  type ExploreSelection,
  type ExploreWindow,
  exploreChartTitle,
  exploreQueryLine,
  matchesTemplate,
} from "~/components/governance/platform/exploreQuery";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { Select } from "~/components/ui/select";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * The explore surface before there is an engine under it.
 *
 * The controls are real and drive the title and the query line; the chart
 * body is not, and says so. Nothing here runs a query.
 *
 * Spec: specs/governance/governance-platform-placeholders.feature
 */
function AnalyticsPage() {
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const orgName = organization?.name ?? "your organization";
  const [timeWindow, setTimeWindow] = useState<ExploreWindow>(
    DEFAULT_EXPLORE_WINDOW,
  );
  const [selection, setSelection] = useState<ExploreSelection>(
    DEFAULT_EXPLORE_SELECTION,
  );
  const patch = (next: Partial<ExploreSelection>) =>
    setSelection((current) => ({ ...current, ...next }));

  return (
    <GovernanceLayout pageTitle="Analytics · AI Governance · LangWatch">
      <VStack align="stretch" gap={5} width="full">
        <HStack justify="space-between" align="start" gap={6}>
          <VStack align="start" gap={1}>
            <Heading size="md">Analytics</Heading>
            <Text color="fg.muted">
              Explore anything in {orgName} using the same engine that powers
              every chart, dashboard, signal and alert.
            </Text>
          </VStack>
          <SegmentedControl
            size="sm"
            value={timeWindow}
            onValueChange={({ value }) => {
              if (value) setTimeWindow(value as ExploreWindow);
            }}
            items={[...EXPLORE_WINDOWS]}
            flexShrink={0}
          />
        </HStack>

        <Tabs.Root defaultValue="explore" variant="line">
          <Tabs.List>
            <Tabs.Trigger
              value="explore"
              color="fg.muted"
              _selected={{ color: "fg", fontWeight: "semibold" }}
            >
              Explore
            </Tabs.Trigger>
            <Tabs.Trigger
              value="dashboards"
              color="fg.muted"
              _selected={{ color: "fg", fontWeight: "semibold" }}
            >
              Dashboards
              <Badge size="xs" variant="subtle" colorPalette="gray">
                0
              </Badge>
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="explore" paddingTop={4}>
            <VStack align="stretch" gap={4}>
              <HStack gap={2} flexWrap="wrap">
                <Text
                  fontSize="xs"
                  fontWeight="semibold"
                  letterSpacing="0.08em"
                  color="fg.muted"
                  textTransform="uppercase"
                  paddingRight={1}
                >
                  Templates
                </Text>
                {EXPLORE_TEMPLATES.map((template) => {
                  const active = matchesTemplate(selection, template);
                  return (
                    <Button
                      key={template.label}
                      size="xs"
                      variant={active ? "subtle" : "outline"}
                      colorPalette={active ? "orange" : "gray"}
                      borderRadius="full"
                      fontWeight={active ? "medium" : "normal"}
                      onClick={() => setSelection(template.selection)}
                    >
                      {template.label}
                    </Button>
                  );
                })}
              </HStack>

              <HStack
                gap={4}
                flexWrap="wrap"
                borderWidth="1px"
                borderColor="border.muted"
                borderRadius="lg"
                paddingX={4}
                paddingY={3}
              >
                <ControlSelect
                  label="Measure"
                  value={selection.measure}
                  onChange={(value) =>
                    patch({ measure: value as ExploreMeasure })
                  }
                  options={EXPLORE_MEASURES}
                />
                <ControlSelect
                  label="Break down by"
                  value={selection.breakdown}
                  onChange={(value) =>
                    patch({ breakdown: value as ExploreBreakdown })
                  }
                  options={EXPLORE_BREAKDOWNS}
                />
                <ControlSelect
                  label="Over time"
                  value={selection.interval}
                  onChange={(value) =>
                    patch({ interval: value as ExploreInterval })
                  }
                  options={EXPLORE_INTERVALS}
                />
                <Button
                  size="sm"
                  variant="outline"
                  borderStyle="dashed"
                  fontWeight="normal"
                >
                  <Filter size={14} />
                  Add filter
                </Button>
              </HStack>

              <VStack
                align="stretch"
                gap={1}
                borderWidth="1px"
                borderColor="border.muted"
                borderRadius="lg"
                padding={5}
                minHeight="440px"
              >
                <Text fontWeight="semibold">
                  {exploreChartTitle(selection)}
                </Text>
                <Text fontSize="sm" color="fg.muted">
                  {orgName} · last {timeWindow}
                </Text>
                <Box
                  flex={1}
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                >
                  <Text color="fg.muted">No data yet</Text>
                </Box>
              </VStack>

              <HStack
                justify="space-between"
                gap={4}
                flexWrap="wrap"
                background="bg.muted"
                borderRadius="lg"
                paddingX={4}
                paddingY={3}
              >
                <HStack gap={3}>
                  <Badge
                    background="fg"
                    color="bg"
                    fontFamily="mono"
                    fontSize="xs"
                  >
                    lwql
                  </Badge>
                  <Text fontFamily="mono" fontSize="sm">
                    {exploreQueryLine(selection)}
                  </Text>
                </HStack>
                <HStack gap={2} color="fg.muted">
                  <Copy size={14} />
                  <Text fontSize="sm">
                    every surface (dashboards, signals, alerts, Langy) compiles
                    to this
                  </Text>
                </HStack>
              </HStack>
            </VStack>
          </Tabs.Content>
          <Tabs.Content value="dashboards" paddingTop={4}>
            <Text color="fg.muted">No dashboards yet.</Text>
          </Tabs.Content>
        </Tabs.Root>
      </VStack>
    </GovernanceLayout>
  );
}

function ControlSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  const collection = useMemo(
    () => createListCollection({ items: [...options] }),
    [options],
  );
  return (
    <Field.Root orientation="horizontal" width="auto" gap={2}>
      <Field.Label
        fontSize="sm"
        color="fg.muted"
        fontWeight="normal"
        whiteSpace="nowrap"
      >
        {label}
      </Field.Label>
      <Select.Root
        collection={collection}
        size="sm"
        width="150px"
        value={[value]}
        onValueChange={({ value: next }) => {
          if (next[0]) onChange(next[0]);
        }}
      >
        <Select.Trigger fontWeight="medium">
          <Select.ValueText />
        </Select.Trigger>
        <Select.Content>
          {options.map((option) => (
            <Select.Item key={option.value} item={option}>
              {option.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Field.Root>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withFeatureFlagGuard("release_ui_governance_billed_cost_enabled", {
    bypassOnboardingRedirect: true,
  })(
    withPermissionGuard("governance:view", {
      bypassOnboardingRedirect: true,
    })(AnalyticsPage),
  ),
);
