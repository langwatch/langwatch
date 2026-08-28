import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Info } from "lucide-react";

import { formatBudgetUsd } from "@langwatch/gateway-web";
import { Tooltip } from "@langwatch/design-system/tooltip";

/**
 * The /me rendering of `api.user.budgetOverview`: one row per budget
 * that binds the user's own keys, most binding first, each labelled
 * with exactly which budget it is ("whole organization budget",
 * "personal budget", "department budget (Engineering)").
 *
 * Visible copy stays minimal - amounts, window, scope phrase; the
 * budget's name, provider filter, per-member semantics, exact reset
 * time and top models live behind the (i) tooltip.
 *
 * Spec: specs/ai-gateway/budget-overview.feature
 */
export type BudgetOverviewItemView = {
  id: string;
  name: string;
  scopeClass: string;
  scopePhrase: string;
  scopeLabel: string;
  window: string;
  limitUsd: string;
  spentUsd: string;
  onBreach: string;
  providerLabel: string | null;
  isPerMember: boolean;
  resetsAt: string | null;
  topModels?: Array<{ model: string; spentUsd: number }>;
};

const WINDOW_PHRASE: Record<string, string> = {
  MINUTE: "this minute",
  HOUR: "this hour",
  DAY: "today",
  WEEK: "this week",
  MONTH: "this month",
  TOTAL: "all time",
};

export function windowPhrase(window: string): string {
  return WINDOW_PHRASE[window.toUpperCase()] ?? window.toLowerCase();
}

const WINDOW_ADJECTIVE: Record<string, string> = {
  MINUTE: "per-minute",
  HOUR: "hourly",
  DAY: "daily",
  WEEK: "weekly",
  MONTH: "monthly",
  TOTAL: "total",
};

/** "MONTH" -> "monthly", for copy like "monthly personal budget". */
export function windowAdjective(window: string): string {
  return WINDOW_ADJECTIVE[window.toUpperCase()] ?? window.toLowerCase();
}

/**
 * How a banner names the budget it is warning about: "monthly personal
 * budget", "weekly department budget". A scope class the server had no
 * wording for drops out rather than inventing one.
 */
export function budgetDescription(item: BudgetOverviewItemView): string {
  const scope = item.scopeClass === "other" ? "" : `${item.scopeClass} `;
  return `${windowAdjective(item.window)} ${scope}budget`;
}

export function formatResetDay(resetsAt: string | null): string | null {
  if (!resetsAt) return null;
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return null;
  // Reset boundaries are computed in UTC, the same clock the ledger's
  // period buckets use, so the promised day matches the actual reset.
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * How much of a budget is spent, and the two thresholds every surface
 * judges it by. One definition: the progress bar's colour, the /me
 * banners and anything else that reacts to a budget filling up must
 * agree, or the bar turns red while the banner still says "approaching".
 */
export function budgetPctUsed(item: BudgetOverviewItemView): number {
  const limit = Number.parseFloat(item.limitUsd);
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  const spent = Number.parseFloat(item.spentUsd) || 0;
  return (spent / limit) * 100;
}

/** Over its limit AND configured to block, so requests are being refused. */
export function isBudgetBreached(item: BudgetOverviewItemView): boolean {
  return budgetPctUsed(item) >= 100 && item.onBreach === "BLOCK";
}

/** Close enough that the member should know before it bites. */
export function isBudgetNearLimit(item: BudgetOverviewItemView): boolean {
  return budgetPctUsed(item) >= 80;
}

function barColor(item: BudgetOverviewItemView): string {
  if (isBudgetBreached(item)) return "red.500";
  if (isBudgetNearLimit(item)) return "yellow.500";
  return "blue.400";
}

export function BudgetOverviewList({ items }: { items: BudgetOverviewItemView[] }) {
  return (
    <VStack align="stretch" gap={4}>
      {items.map((item) => {
        const resetDay = formatResetDay(item.resetsAt);
        const pctUsed = budgetPctUsed(item);
        return (
          <VStack key={item.id} align="stretch" gap={1}>
            <HStack gap={2} alignItems="baseline">
              <Text fontSize="sm">
                <Text as="span" fontWeight="semibold">
                  {formatBudgetUsd(Number.parseFloat(item.spentUsd) || 0)}
                </Text>{" "}
                of{" "}
                <Text as="span" fontWeight="semibold">
                  {formatBudgetUsd(Number.parseFloat(item.limitUsd) || 0)}
                </Text>{" "}
                {windowPhrase(item.window)}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                ({item.scopePhrase}
                {item.providerLabel ? `, ${item.providerLabel} only` : ""})
              </Text>
              <Tooltip
                openDelay={100}
                positioning={{ placement: "top" }}
                content={<BudgetTooltip item={item} />}
              >
                <Box
                  as="span"
                  color="fg.muted"
                  cursor="default"
                  display="inline-flex"
                  // A span takes no focus of its own, so without tabIndex a
                  // keyboard user can never open the tooltip that holds the
                  // budget's name, provider filter and reset time.
                  tabIndex={0}
                  role="img"
                  aria-label={`About ${item.name}`}
                >
                  <Info size={13} />
                </Box>
              </Tooltip>
              {resetDay && (
                <Text fontSize="xs" color="fg.muted" marginLeft="auto">
                  resets {resetDay}
                </Text>
              )}
            </HStack>
            <Box
              height="6px"
              backgroundColor="bg.muted"
              borderRadius="full"
              overflow="hidden"
            >
              <Box
                height="full"
                width={`${Math.min(100, Math.max(pctUsed > 0 ? 2 : 0, pctUsed))}%`}
                backgroundColor={barColor(item)}
                borderRadius="full"
              />
            </Box>
          </VStack>
        );
      })}
    </VStack>
  );
}

function BudgetTooltip({ item }: { item: BudgetOverviewItemView }) {
  return (
    <VStack gap={0.5} align="start">
      <Text fontWeight="semibold">{item.name}</Text>
      {item.providerLabel && <Text>Counts {item.providerLabel} spend only</Text>}
      {item.isPerMember && (
        <Text>Per-member allowance: each member of {item.scopeLabel} gets this much</Text>
      )}
      {item.onBreach === "BLOCK" ? (
        <Text>Blocks requests when the limit is reached</Text>
      ) : (
        <Text>Warns when the limit is reached, without blocking</Text>
      )}
      {item.resetsAt && <Text>Resets {new Date(item.resetsAt).toLocaleString()}</Text>}
      {item.topModels && item.topModels.length > 0 && (
        <>
          <Text marginTop={1}>Top models this month:</Text>
          {item.topModels.map((m) => (
            <Text key={m.model}>
              {m.model}: {formatBudgetUsd(m.spentUsd)}
            </Text>
          ))}
        </>
      )}
    </VStack>
  );
}
