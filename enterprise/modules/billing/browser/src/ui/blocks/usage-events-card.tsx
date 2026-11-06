/**
 * This month's events against what the plan includes, day by day, and when the count resets.
 * @see specs/licensing/usage-page.feature
 */
import { Banner } from "@langwatch/design-system/banner";
import { Card } from "@langwatch/design-system/card";
import { DailyBarChart, type DailyBar } from "@langwatch/design-system/daily-bar-chart";
import { MeterBar } from "@langwatch/design-system/meter-bar";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { HStack, Spacer, Text, VStack } from "@langwatch/design-system/primitives";
import { Activity } from "lucide-react";

import { allowanceText, type MonthEvents } from "../../model/usage-page-state.ts";

const METER_FILL: Record<MonthEvents["status"], string> = {
  ok: "blue.solid",
  warning: "orange.solid",
  exceeded: "red.solid",
};

export const SET_UP_TRACING_HREF = "https://langwatch.ai/docs/integration/quick-start";

export type UsageEventsCardState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "empty"; cap: string | null }
  | {
      kind: "month";
      events: MonthEvents;
      chart: { bars: DailyBar[]; axis: string[]; summary: string } | null;
    };

function Muted({ children }: { children: string }) {
  return (
    <Text textStyle="bodySm" color="fg.muted">
      {children}
    </Text>
  );
}

function EventsBody({ state }: { state: UsageEventsCardState }) {
  if (state.kind === "loading") return <Muted>Loading this month's events.</Muted>;
  if (state.kind === "unavailable") {
    return (
      <Banner status="warning" data-testid="usage-events-unavailable">
        This month's events could not be loaded. Refresh the page to try again.
      </Banner>
    );
  }
  if (state.kind === "empty") {
    return (
      <NoDataInfoBlock
        size="inline"
        testId="usage-events-empty"
        icon={<Activity size={20} aria-hidden />}
        title="No events yet this month."
        description="Send your first trace and it shows up here."
        next={[{ kind: "docs", label: "Set up tracing", href: SET_UP_TRACING_HREF }]}
      />
    );
  }
  const { events, chart } = state;
  return (
    <VStack align="stretch" gap={4}>
      <HStack align="baseline" gap={2}>
        <Text textStyle="metric" fontVariantNumeric="tabular-nums" data-testid="usage-events-count">
          {events.count}
        </Text>
        {events.allowance && <Muted>{allowanceText(events.allowance)}</Muted>}
        <Spacer />
        {events.fillRatio !== null && (
          <MeterBar
            fillRatio={events.fillRatio}
            width="160px"
            height="6px"
            fillColor={METER_FILL[events.status]}
            data-testid="usage-events-meter"
          />
        )}
      </HStack>
      {chart && (
        <DailyBarChart
          bars={chart.bars}
          axis={chart.axis}
          summary={chart.summary}
          data-testid="usage-daily-chart"
        />
      )}
    </VStack>
  );
}

export function UsageEventsCard({
  state,
  title,
  resetsOn,
}: {
  state: UsageEventsCardState;
  /** "Events this month", or "Traces this month" where the plan counts traces. */
  title: string;
  /** "Resets on 1 Dec"; absent until the month is read. */
  resetsOn?: string;
}) {
  const aside = state.kind === "empty" && state.cap ? `0 of ${state.cap} included` : resetsOn;
  return (
    <Card
      data-testid="usage-events-card"
      title={title}
      actions={aside ? <Muted>{aside}</Muted> : undefined}
    >
      <EventsBody state={state} />
    </Card>
  );
}
