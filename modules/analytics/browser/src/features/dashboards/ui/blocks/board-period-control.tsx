/**
 * The period pill ("30d", "30d · 1d", "Live", "4 Nov - 11 Nov") and its menu: Range, Grain,
 * Refresh, then "Refresh now". Custom opens the date range fields beside the pill. Unfit grains
 * are greyed out; Live refreshes every minute; an ended custom range never does (AC19).
 */

import { DateRangeFields } from "@langwatch/design-system/date-range-picker";
import { Menu } from "@langwatch/design-system/menu";
import { Popover } from "@langwatch/design-system/popover";
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { format, toEpochMs } from "@langwatch/time";
import { Check, ChevronDown, Clock, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  DASHBOARD_AUTO_REFRESH_OPTIONS,
  type DashboardAutoRefreshOption,
} from "../../../../behavior/use-dashboard-auto-refresh.ts";
import {
  type BoardCustomWindow,
  boardCustomInShort,
  boardGrainFits,
  BOARD_PERIOD_GRAINS,
  BOARD_PERIOD_PRESETS,
  type BoardPeriod,
  type BoardPeriodGrain,
  type BoardPeriodPreset,
  type BoardPeriodRange,
} from "../../model/board-period.ts";

const REFRESH_LABEL: Readonly<Record<DashboardAutoRefreshOption, string>> = {
  off: "off",
  "1m": "every 1m",
  "5m": "every 5m",
};

const REFRESH_ENDED_NOTE = "Only applies when the range ends now";

/** The text a datetime-local field holds. */
const FIELD_FORMAT = "yyyy-MM-dd'T'HH:mm";

function LiveDot() {
  return <Box as="span" boxSize="6px" borderRadius="full" background="green.solid" />;
}

function PeriodOption({ selected, children }: { selected: boolean; children: ReactNode }) {
  return (
    <HStack width="full" gap={2} textStyle="bodySm">
      <HStack as="span" gap={2} fontFamily="mono">
        {children}
      </HStack>
      {selected && (
        <Box marginLeft="auto" color="fg">
          <Check size={13} aria-label="selected" />
        </Box>
      )}
    </HStack>
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <VStack align="stretch" gap={0} minWidth="120px" flex={1} padding={1}>
      <Menu.ItemGroup title={title}>{children}</Menu.ItemGroup>
    </VStack>
  );
}

function PillLabel({
  range,
  grain,
  custom,
}: {
  range: BoardPeriodRange;
  grain: BoardPeriodGrain;
  custom?: BoardCustomWindow;
}) {
  if (range === "live") {
    return (
      <>
        <LiveDot />
        <Text as="span" fontWeight="medium" color="green.fg">
          Live
        </Text>
      </>
    );
  }
  return (
    <>
      <Box as="span" color="fg.subtle">
        <Clock size={13} aria-hidden />
      </Box>
      <Text as="span" fontFamily="mono" fontWeight="medium" color="fg">
        {custom ? boardCustomInShort(custom) : range}
      </Text>
      {grain !== "auto" && (
        <Text as="span" color="gray.400">
          · {grain}
        </Text>
      )}
    </>
  );
}

/** The custom range's start and end, drafted until Apply. */
function CustomRangeForm({
  period,
  onApply,
  onCancel,
}: {
  period: BoardPeriod;
  onApply: (window: BoardCustomWindow) => void;
  onCancel: () => void;
}) {
  const [start, setStart] = useState(() => format(period.periodStart, FIELD_FORMAT));
  const [end, setEnd] = useState(() => format(period.periodEnd, FIELD_FORMAT));
  const from = toEpochMs(start);
  const to = toEpochMs(end);
  const readable = Number.isFinite(from) && Number.isFinite(to);
  const ordered = readable && from < to;

  return (
    <VStack align="stretch" gap={3}>
      <DateRangeFields
        startValue={start}
        endValue={end}
        onStartChange={setStart}
        onEndChange={setEnd}
      />
      {readable && !ordered && (
        <Text textStyle="caption" color="fg.error">
          The start must come before the end.
        </Text>
      )}
      <HStack justify="flex-end" gap={2}>
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="xs" disabled={!ordered} onClick={() => onApply({ from, to })}>
          Apply
        </Button>
      </HStack>
    </VStack>
  );
}

export function BoardPeriodControl({
  range,
  grain,
  custom,
  period,
  refresh,
  refreshApplies = true,
  onRangeChange,
  onCustomChange,
  onGrainChange,
  onRefreshChange,
  onRefreshNow,
}: {
  readonly range: BoardPeriodRange;
  readonly grain: BoardPeriodGrain;
  /** The window of a custom range. */
  readonly custom?: BoardCustomWindow;
  /** The window the board reads now: what Custom starts from, and what grains must fit. */
  readonly period: BoardPeriod;
  /** The refresh in force: every minute while Live, off once a custom range ended. */
  readonly refresh: DashboardAutoRefreshOption;
  /** False once a custom range has ended, so there is nothing new to refresh to. */
  readonly refreshApplies?: boolean;
  readonly onRangeChange: (range: BoardPeriodPreset) => void;
  readonly onCustomChange: (window: BoardCustomWindow) => void;
  readonly onGrainChange: (grain: BoardPeriodGrain) => void;
  readonly onRefreshChange: (refresh: DashboardAutoRefreshOption) => void;
  /** Re-runs every widget now. */
  readonly onRefreshNow: () => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const live = range === "live";
  const spanMs = period.periodEnd - period.periodStart;
  const refreshLocked = (option: DashboardAutoRefreshOption) =>
    (live && option !== "1m") || !refreshApplies;
  const refreshNote = (option: DashboardAutoRefreshOption) => {
    if (!refreshApplies) return REFRESH_ENDED_NOTE;
    return live && option !== "1m" ? "Live refreshes every minute" : void 0;
  };

  return (
    <Popover.Root
      open={customOpen}
      onOpenChange={({ open }) => setCustomOpen(open)}
      positioning={{ placement: "bottom-end" }}
      size="sm"
    >
      <Popover.Anchor asChild>
        <Box display="inline-flex">
          <Menu.Root positioning={{ placement: "bottom-end" }}>
            <Menu.Trigger asChild>
              <Button
                variant="outline"
                aria-label="Period"
                title="Time range, grain and refresh"
                height="26px"
                minWidth={0}
                paddingX={2.5}
                paddingY={0}
                gap={1.5}
                borderRadius="lg"
                borderColor="border"
                background="bg.panel"
                textStyle="caption"
                fontWeight="normal"
                _hover={{ borderColor: "border.emphasized", background: "bg.panel" }}
              >
                <PillLabel range={range} grain={grain} custom={custom} />
                <Box as="span" color="gray.400">
                  <ChevronDown size={12} aria-hidden />
                </Box>
              </Button>
            </Menu.Trigger>
            <Menu.Content padding={0}>
              <HStack align="stretch" gap={0}>
                <Column title="Range">
                  {BOARD_PERIOD_PRESETS.map((option) => (
                    <Menu.Item
                      key={option}
                      value={`range-${option}`}
                      onClick={() => onRangeChange(option)}
                    >
                      <PeriodOption selected={option === range}>
                        {option === "live" ? (
                          <>
                            <LiveDot />
                            <Text as="span" fontFamily="body">
                              Live
                            </Text>
                          </>
                        ) : (
                          option
                        )}
                      </PeriodOption>
                    </Menu.Item>
                  ))}
                  <Menu.Item value="range-custom" onClick={() => setCustomOpen(true)}>
                    <PeriodOption selected={range === "custom"}>
                      <Text as="span" fontFamily="body">
                        Custom
                      </Text>
                    </PeriodOption>
                  </Menu.Item>
                </Column>
                <Box borderLeftWidth="1px" borderColor="border" />
                <Column title="Grain">
                  {BOARD_PERIOD_GRAINS.map((option) => (
                    <Menu.Item
                      key={option}
                      value={`grain-${option}`}
                      disabled={!boardGrainFits({ spanMs, grain: option })}
                      onClick={() => onGrainChange(option)}
                    >
                      <PeriodOption selected={option === grain}>{option}</PeriodOption>
                    </Menu.Item>
                  ))}
                </Column>
                <Box borderLeftWidth="1px" borderColor="border" />
                <Column title="Refresh">
                  {DASHBOARD_AUTO_REFRESH_OPTIONS.map((option) => (
                    <Menu.Item
                      key={option}
                      value={`refresh-${option}`}
                      disabled={refreshLocked(option)}
                      title={refreshNote(option)}
                      onClick={() => onRefreshChange(option)}
                    >
                      <PeriodOption selected={option === refresh}>
                        {REFRESH_LABEL[option]}
                      </PeriodOption>
                    </Menu.Item>
                  ))}
                  {!refreshApplies && (
                    <Text
                      textStyle="caption"
                      color="fg.muted"
                      paddingX={2}
                      paddingY={1}
                      maxWidth="130px"
                    >
                      {REFRESH_ENDED_NOTE}
                    </Text>
                  )}
                </Column>
              </HStack>
              <Box borderTopWidth="1px" borderColor="border" padding={1}>
                <Menu.Item value="refresh-now" onClick={onRefreshNow}>
                  <HStack gap={2} textStyle="bodySm">
                    <Box as="span" display="flex" color="fg.muted">
                      <RefreshCw size={13} aria-hidden />
                    </Box>
                    Refresh now
                  </HStack>
                </Menu.Item>
              </Box>
            </Menu.Content>
          </Menu.Root>
        </Box>
      </Popover.Anchor>
      <Popover.Content width="fit-content">
        <Popover.Header>
          <Popover.Title fontWeight="semibold">Custom range</Popover.Title>
        </Popover.Header>
        <Popover.Body paddingTop={0}>
          {customOpen && (
            <CustomRangeForm
              period={period}
              onCancel={() => setCustomOpen(false)}
              onApply={(window) => {
                onCustomChange(window);
                setCustomOpen(false);
              }}
            />
          )}
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
