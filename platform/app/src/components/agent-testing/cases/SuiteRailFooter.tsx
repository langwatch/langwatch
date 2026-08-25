/**
 * The foot of the suites rail: the period every read of the tab is scoped to,
 * and the control that folds the rail away.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 */

import { HStack, IconButton, Spacer } from "@chakra-ui/react";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { PeriodSelector } from "~/components/PeriodSelector";
import type { SuiteRailProps } from "./SuiteRail";

export type SuiteRailFooterProps = Pick<
  SuiteRailProps,
  | "collapsed"
  | "onToggleCollapsed"
  | "period"
  | "periodMode"
  | "setPeriod"
  | "setRelativePeriod"
>;

export function SuiteRailFooter({
  collapsed,
  onToggleCollapsed,
  period,
  periodMode,
  setPeriod,
  setRelativePeriod,
}: SuiteRailFooterProps) {
  return (
    <HStack
      gap={2}
      paddingX={2}
      paddingY={2}
      borderTopWidth="1px"
      borderColor="border"
    >
      {!collapsed && (
        <PeriodSelector
          period={period}
          mode={periodMode}
          setPeriod={setPeriod}
          setRelativePeriod={setRelativePeriod}
          size="xs"
          triggerVariant="ghost"
          placement="top-start"
        />
      )}
      <Spacer />
      <IconButton
        aria-label={collapsed ? "Expand the rail" : "Collapse the rail"}
        size="xs"
        variant="ghost"
        onClick={onToggleCollapsed}
      >
        {collapsed ? <PanelLeftOpen size={14} /> : <PanelRightOpen size={14} />}
      </IconButton>
    </HStack>
  );
}
