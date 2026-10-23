import { Card } from "@langwatch/design-system/card";
import { FormattedNumber } from "@langwatch/design-system/formatted-number";
import { Box, Button, HStack, SimpleGrid, Text, VStack } from "@langwatch/design-system/primitives";
import {
  StatTile,
  StatTileFigure,
  StatTileGrid,
  StatTileSkeleton,
} from "@langwatch/design-system/stat-tile";
import { TYPE_SCALE_PX } from "@langwatch/design-system/typography";
import { readableDate } from "@langwatch/time";
import { Activity, BadgeCheck, Sparkles, Waypoints } from "lucide-react";
import type { ReactNode } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  instanceName,
  reportNumber,
  SIGNAL_LABELS,
  type SelfHostedInstanceSummary,
  type SelfHostedSignal,
} from "../../model/self-hosted-instance.ts";

const TILE_COLUMNS = 4;

/**
 * What the registry adds up to, above the list: how many installs report,
 * how many arrived lately, which ones to talk to. A signal or an install
 * here narrows or opens the list below.
 */
export function InstancesSummary({
  summary,
  activeSignal,
  onSignal,
  onOpen,
}: {
  summary: SelfHostedInstanceSummary | undefined;
  activeSignal: SelfHostedSignal | undefined;
  onSignal: (signal: SelfHostedSignal | undefined) => void;
  onOpen: (id: string) => void;
}) {
  if (!summary) return <StatTileSkeleton columns={TILE_COLUMNS} />;
  const openSource = summary.total - summary.licensed;

  return (
    <VStack align="stretch" gap={3} width="full" data-testid="self-hosted-summary">
      <StatTileGrid columns={TILE_COLUMNS}>
        <StatTile
          label="Reporting"
          icon={<Activity size={14} />}
          hint={`${summary.quiet} quiet, ${summary.gone} gone, ${summary.total} in all`}
        >
          <StatTileFigure>{summary.reporting}</StatTileFigure>
        </StatTile>
        <StatTile
          label="New this week"
          icon={<Sparkles size={14} />}
          hint={`${summary.newLast30Days} in the last 30 days`}
        >
          <StatTileFigure>{summary.newLast7Days}</StatTileFigure>
        </StatTile>
        <StatTile
          label="Licensed"
          icon={<BadgeCheck size={14} />}
          hint={`${openSource} open source`}
        >
          <StatTileFigure>{summary.licensed}</StatTileFigure>
        </StatTile>
        <StatTile
          label="Traces, last 28 days"
          icon={<Waypoints size={14} />}
          hint="Across the installs still reporting"
        >
          <StatTileFigure>
            <FormattedNumber value={summary.traces28d} />
          </StatTileFigure>
        </StatTile>
      </StatTileGrid>

      <SimpleGrid columns={{ base: 1, lg: 2 }} gap={3} width="full">
        <Card title="New installs per week" titleLevel={3}>
          <NewInstallsChart weeks={summary.newPerWeek} />
        </Card>
        <Card
          title="Busiest open source installs"
          titleLevel={3}
          description="Still reporting, most traces over the last 28 days"
        >
          <SummaryRows empty="No open source install reported traces lately.">
            {summary.busiestOpenSource.map((instance) => (
              <SummaryRow
                key={instance.id}
                label={instanceName(instance)}
                detail={instance.hostname ?? instance.instanceId}
                onClick={() => onOpen(instance.id)}
              >
                <FormattedNumber value={reportNumber(instance.latestReport, "traces_28d") ?? 0} />{" "}
                traces
              </SummaryRow>
            ))}
          </SummaryRows>
        </Card>
        <Card
          title="Signals raised"
          titleLevel={3}
          description="Pick one to list only the installs that raised it"
        >
          <SummaryRows empty="No install has raised a signal.">
            {summary.signals.map(({ signal, count }) => (
              <SummaryRow
                key={signal}
                label={SIGNAL_LABELS[signal]}
                selected={activeSignal === signal}
                onClick={() => onSignal(activeSignal === signal ? undefined : signal)}
              >
                {count}
              </SummaryRow>
            ))}
          </SummaryRows>
        </Card>
        <Card
          title="Releases in use"
          titleLevel={3}
          description="Installs reporting in the last fortnight"
        >
          <SummaryRows empty="No install reported its release lately.">
            {summary.releases.map(({ version, count }) => (
              <SummaryRow key={version} label={version}>
                {count}
              </SummaryRow>
            ))}
          </SummaryRows>
        </Card>
      </SimpleGrid>
    </VStack>
  );
}

function SummaryRows({ empty, children }: { empty: string; children: ReactNode[] }) {
  if (children.length === 0) {
    return (
      <Text textStyle="sm" color="fg.muted">
        {empty}
      </Text>
    );
  }
  return (
    <VStack align="stretch" gap={0.5} width="full">
      {children}
    </VStack>
  );
}

function SummaryRow({
  label,
  detail,
  selected = false,
  onClick,
  children,
}: {
  label: string;
  detail?: string;
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const content = (
    <HStack justify="space-between" width="full" gap={3} minWidth={0}>
      <VStack align="start" gap={0} minWidth={0}>
        <Text textStyle="sm" truncate maxWidth="full">
          {label}
        </Text>
        {detail ? (
          <Text textStyle="xs" color="fg.muted" truncate maxWidth="full">
            {detail}
          </Text>
        ) : null}
      </VStack>
      <Text textStyle="sm" fontVariantNumeric="tabular-nums" flexShrink={0}>
        {children}
      </Text>
    </HStack>
  );
  if (!onClick)
    return (
      <Box paddingX={2} paddingY={1}>
        {content}
      </Box>
    );
  return (
    <Button
      variant={selected ? "subtle" : "ghost"}
      size="sm"
      height="auto"
      paddingX={2}
      paddingY={1}
      justifyContent="stretch"
      fontWeight="normal"
      aria-pressed={selected}
      onClick={onClick}
    >
      {content}
    </Button>
  );
}

function NewInstallsChart({ weeks }: { weeks: SelfHostedInstanceSummary["newPerWeek"] }) {
  const points = weeks.map((week) => ({
    label: readableDate(week.weekStart).toLocaleDateString([], { day: "numeric", month: "short" }),
    count: week.count,
  }));
  return (
    <Box height="180px" width="full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            fontSize={TYPE_SCALE_PX.caption}
            interval="preserveStartEnd"
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            fontSize={TYPE_SCALE_PX.caption}
          />
          <Tooltip
            cursor={{ fill: "var(--chakra-colors-bg-muted)" }}
            formatter={(value) => [value, "New installs"]}
            labelFormatter={(label) => `Week from ${label}`}
            contentStyle={{
              background: "var(--chakra-colors-bg-panel)",
              border: "1px solid var(--chakra-colors-border)",
              borderRadius: 6,
              fontSize: TYPE_SCALE_PX.caption,
            }}
          />
          <Bar dataKey="count" fill="var(--chakra-colors-accent-solid)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
