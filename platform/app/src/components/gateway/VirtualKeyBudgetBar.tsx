import { Box } from "@chakra-ui/react";
import { MeterBar } from "~/components/ui/MeterBar";
import { Tooltip } from "~/components/ui/tooltip";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { formatBudgetUsd } from "./formatBudgetUsd";

export type VirtualKeyBudgetBarValue = {
  budgetId: string;
  window: string;
  limitUsd: string;
  /** Null when the rollup could not be totalled: unknown, not zero. */
  periodSpentUsd: string | null;
  resetsAt: string;
};

const WINDOW_ADJECTIVE: Record<string, string> = {
  MINUTE: "per-minute",
  HOUR: "hourly",
  DAY: "daily",
  WEEK: "weekly",
  MONTH: "monthly",
  TOTAL: "total",
};

function windowAdjective(window: string): string {
  return WINDOW_ADJECTIVE[window] ?? window.toLowerCase();
}

/**
 * What the bar is saying, in one line. The period is named because the
 * value above the bar is the calendar month and this one is not: a key
 * at $2.50 for the month can be at $0.50 of a $1.00 day, and the reader
 * has to be able to tell which number is which.
 */
export function budgetBarLabel(value: VirtualKeyBudgetBarValue): string {
  const adjective = windowAdjective(value.window);
  const limit = formatBudgetUsd(value.limitUsd);
  if (value.periodSpentUsd === null) {
    return `${limit} ${adjective} budget, spend unavailable`;
  }
  const head = `${formatBudgetUsd(value.periodSpentUsd)} of ${limit} ${adjective} budget`;
  // TOTAL is a lifetime allowance; there is no period to reset.
  if (value.window === "TOTAL") return head;
  const resets = formatTimeAgo(new Date(value.resetsAt).getTime());
  return resets ? `${head}, resets ${resets}` : head;
}

function fillColorFor(ratio: number): string {
  if (ratio >= 1) return "red.solid";
  if (ratio >= 0.8) return "orange.solid";
  return "green.solid";
}

/**
 * Current-period spend against the budget a key carries on itself, in
 * the trace table's meter style. Only keys with a budget of their own
 * render one, because an empty track under every other key would read as
 * a limit that is not there.
 */
export function VirtualKeyBudgetBar({
  value,
  virtualKeyId,
}: {
  value: VirtualKeyBudgetBarValue | undefined;
  virtualKeyId: string;
}) {
  if (!value) return null;

  const limit = Number.parseFloat(value.limitUsd);
  const spent =
    value.periodSpentUsd === null ? null : Number.parseFloat(value.periodSpentUsd);
  const ratio =
    spent === null || !Number.isFinite(spent) || !Number.isFinite(limit) || limit <= 0
      ? null
      : spent / limit;
  const label = budgetBarLabel(value);

  return (
    <Tooltip content={label}>
      <Box
        width="full"
        cursor="help"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Number.isFinite(limit) ? limit : undefined}
        aria-valuenow={spent ?? undefined}
        data-testid={`vk-budget-bar-${virtualKeyId}`}
      >
        <MeterBar
          fillRatio={ratio}
          width="100%"
          height="3px"
          fillColor={ratio === null ? "border.subtle" : fillColorFor(ratio)}
        />
      </Box>
    </Tooltip>
  );
}
