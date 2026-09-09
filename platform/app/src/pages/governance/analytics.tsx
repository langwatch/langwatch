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
 * body is not, and says so. Nothing here runs a query, so the page carries
 * the Preview badge and no control that cannot act.
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

  return (
    <GovernanceLayout pageTitle="Analytics · AI Governance · LangWatch">
      <VStack align="stretch" gap={5} width="full">
        <HStack justify="space-between" align="start" gap={6}>
          <VStack align="start" gap={1}>
            <HStack gap={2}>
              <Heading size="md">Analytics</Heading>
              <Badge colorPalette="purple" size="sm" variant="surface">
                Preview
              </Badge>
            </HStack>
            <Text color="fg.muted">
              A preview of how you will explore activity in {orgName}. The
              controls below shape a query; running it is coming.
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

        <Tabs.Root
          defaultValue="explore"
          variant="line"
          lazyMount
          unmountOnExit
        >
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
            <ExploreTab
              orgName={orgName}
              timeWindow={timeWindow}
              selection={selection}
              onSelectionChange={setSelection}
            />
          </Tabs.Content>
          <Tabs.Content value="dashboards" paddingTop={4}>
            <Text color="fg.muted">Dashboards are not available yet.</Text>
          </Tabs.Content>
        </Tabs.Root>
      </VStack>
    </GovernanceLayout>
  );
}

/** Template chips, the three controls, the chart body and the query line. */
function ExploreTab({
  orgName,
  timeWindow,
  selection,
  onSelectionChange,
}: {
  orgName: string;
  timeWindow: ExploreWindow;
  selection: ExploreSelection;
  onSelectionChange: (selection: ExploreSelection) => void;
}) {
  const patch = (next: Partial<ExploreSelection>) =>
    onSelectionChange({ ...selection, ...next });

  return (
    <VStack align="stretch" gap={4}>
      <TemplateChips selection={selection} onPick={onSelectionChange} />
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
          onChange={(value) => patch({ measure: value as ExploreMeasure })}
          options={EXPLORE_MEASURES}
        />
        <ControlSelect
          label="Break down by"
          value={selection.breakdown}
          onChange={(value) => patch({ breakdown: value as ExploreBreakdown })}
          options={EXPLORE_BREAKDOWNS}
        />
        <ControlSelect
          label="Over time"
          value={selection.interval}
          onChange={(value) => patch({ interval: value as ExploreInterval })}
          options={EXPLORE_INTERVALS}
        />
      </HStack>
      <ExploreChart
        selection={selection}
        orgName={orgName}
        timeWindow={timeWindow}
      />
      <QueryLine selection={selection} />
    </VStack>
  );
}

function TemplateChips({
  selection,
  onPick,
}: {
  selection: ExploreSelection;
  onPick: (selection: ExploreSelection) => void;
}) {
  return (
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
            onClick={() => onPick(template.selection)}
          >
            {template.label}
          </Button>
        );
      })}
    </HStack>
  );
}

/** The chart body is not connected to anything yet and says so. */
function ExploreChart({
  selection,
  orgName,
  timeWindow,
}: {
  selection: ExploreSelection;
  orgName: string;
  timeWindow: ExploreWindow;
}) {
  return (
    <VStack
      align="stretch"
      gap={1}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="lg"
      padding={5}
      minHeight="440px"
    >
      <Text fontWeight="semibold">{exploreChartTitle(selection)}</Text>
      <Text fontSize="sm" color="fg.muted">
        {orgName} · last {timeWindow}
      </Text>
      <Box flex={1} display="flex" alignItems="center" justifyContent="center">
        <Text color="fg.muted">
          This chart is not connected to your data yet
        </Text>
      </Box>
    </VStack>
  );
}

function QueryLine({ selection }: { selection: ExploreSelection }) {
  return (
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
        <Badge background="fg" color="bg" fontFamily="mono" fontSize="xs">
          lwql
        </Badge>
        <Text fontFamily="mono" fontSize="sm">
          {exploreQueryLine(selection)}
        </Text>
      </HStack>
      <Text fontSize="sm" color="fg.muted">
        the query these controls describe, once queries run
      </Text>
    </HStack>
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
