/**
 * The period pill ("30d", "30d · 1d", "Live") and its menu: Range, Grain, Refresh, then
 * "Refresh now". Unfit grains are greyed out; Live refreshes every minute (dashboards-v2 AC19).
 */

import { Menu } from "@langwatch/design-system/menu";
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Check, ChevronDown, Clock, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import {
  DASHBOARD_AUTO_REFRESH_OPTIONS,
  type DashboardAutoRefreshOption,
} from "../../../../behavior/use-dashboard-auto-refresh.ts";
import {
  BOARD_PERIOD_GRAINS,
  BOARD_PERIOD_RANGES,
  boardGrainFits,
  type BoardPeriodGrain,
  type BoardPeriodRange,
} from "../../model/board-period.ts";

const REFRESH_LABEL: Readonly<Record<DashboardAutoRefreshOption, string>> = {
  off: "off",
  "1m": "every 1m",
  "5m": "every 5m",
};

function LiveDot() {
  return <Box as="span" boxSize="6px" borderRadius="full" background="green.solid" />;
}

function PeriodOption({ selected, children }: { selected: boolean; children: ReactNode }) {
  return (
    <HStack width="full" gap={2} fontSize="12.5px">
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

export function BoardPeriodControl({
  range,
  grain,
  refresh,
  onRangeChange,
  onGrainChange,
  onRefreshChange,
  onRefreshNow,
}: {
  readonly range: BoardPeriodRange;
  readonly grain: BoardPeriodGrain;
  /** The refresh in force: every minute while Live, otherwise the member's pick. */
  readonly refresh: DashboardAutoRefreshOption;
  readonly onRangeChange: (range: BoardPeriodRange) => void;
  readonly onGrainChange: (grain: BoardPeriodGrain) => void;
  readonly onRefreshChange: (refresh: DashboardAutoRefreshOption) => void;
  /** Re-runs every widget now. */
  readonly onRefreshNow: () => void;
}) {
  const live = range === "live";
  return (
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
          fontSize="12px"
          fontWeight="normal"
          _hover={{ borderColor: "border.emphasized", background: "bg.panel" }}
        >
          {live ? (
            <>
              <LiveDot />
              <Text as="span" fontWeight="medium" color="green.fg">
                Live
              </Text>
            </>
          ) : (
            <>
              <Box as="span" color="fg.subtle">
                <Clock size={13} aria-hidden />
              </Box>
              <Text as="span" fontFamily="mono" fontWeight="medium" color="fg">
                {range}
              </Text>
              {grain !== "auto" && (
                <Text as="span" color="gray.400">
                  · {grain}
                </Text>
              )}
              {refresh !== "off" && (
                <HStack as="span" gap={0.5} color="gray.400" title={REFRESH_LABEL[refresh]}>
                  <RefreshCw size={11} aria-label="auto-refresh" />
                  <Text as="span" fontFamily="mono">
                    {refresh}
                  </Text>
                </HStack>
              )}
            </>
          )}
          <Box as="span" color="gray.400">
            <ChevronDown size={12} aria-hidden />
          </Box>
        </Button>
      </Menu.Trigger>
      <Menu.Content padding={0}>
        <HStack align="stretch" gap={0}>
          <Column title="Range">
            {BOARD_PERIOD_RANGES.map((option) => (
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
          </Column>
          <Box borderLeftWidth="1px" borderColor="border" />
          <Column title="Grain">
            {BOARD_PERIOD_GRAINS.map((option) => (
              <Menu.Item
                key={option}
                value={`grain-${option}`}
                disabled={!boardGrainFits({ range, grain: option })}
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
                disabled={live && option !== "1m"}
                title={live && option !== "1m" ? "Live refreshes every minute" : void 0}
                onClick={() => onRefreshChange(option)}
              >
                <PeriodOption selected={option === refresh}>{REFRESH_LABEL[option]}</PeriodOption>
              </Menu.Item>
            ))}
          </Column>
        </HStack>
        <Box borderTopWidth="1px" borderColor="border" padding={1}>
          <Menu.Item value="refresh-now" onClick={onRefreshNow}>
            <HStack gap={2} fontSize="12.5px">
              <Box as="span" display="flex" color="fg.muted">
                <RefreshCw size={13} aria-hidden />
              </Box>
              Refresh now
            </HStack>
          </Menu.Item>
        </Box>
      </Menu.Content>
    </Menu.Root>
  );
}
