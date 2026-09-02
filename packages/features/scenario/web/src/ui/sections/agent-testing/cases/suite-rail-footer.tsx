/**
 * The foot of the suites rail: the period every read of the tab is scoped to,
 * and the control that folds the rail away.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 */

import { HStack, IconButton, Spacer } from "@chakra-ui/react";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { AgentTestingPeriodPicker } from "../../../elements/agent-testing/shared/period-picker";
import type { SuiteRailProps } from "./suite-rail";

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
  setRelativePeriod,
}: SuiteRailFooterProps) {
  return (
    <HStack gap={2} paddingX={3} paddingBottom={4} paddingTop={4}>
      {!collapsed && (
        <AgentTestingPeriodPicker
          period={period}
          setRelativePeriod={setRelativePeriod}
          compact
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
