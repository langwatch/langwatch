import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { HelpCircle } from "lucide-react";
import { formatBudgetUsd } from "~/components/gateway/formatBudgetUsd";
import { Tooltip } from "~/components/ui/tooltip";
import {
  CATEGORIES,
  type Category,
  categoryLabel,
} from "~/server/app-layer/traces/block-classification/categories";

/**
 * Shared cost-breakdown-by-content-category lanes (ADR-033 PR D), rendered on
 * both the /me usage view and the org Activity Monitor. Presentational only —
 * the caller decides the window, fetches the rows, and owns the empty-state
 * (use `CategoryBreakdownEnablementHint` when there is nothing to show).
 *
 * Copy shows the human category label, never the raw wire enum
 * (dev/docs/best_practices/copywriting.md).
 */
export interface CategoryBreakdownBarRow {
  /** Wire taxonomy value — stable React key. */
  category: string;
  /** Human-readable lane label. */
  label: string;
  costUsd: number;
  tokens: number;
  /** Share of total category cost, 0–100. */
  sharePct: number;
}

/**
 * Turn raw per-category totals into bar rows: attach the human label and each
 * lane's share of the total cost. Single source for both surfaces so the /me
 * view and the Activity Monitor derive shares identically.
 */
export function toCategoryBarRows(
  rows: Array<{ category: string; costUsd: number; tokens: number }>,
): CategoryBreakdownBarRow[] {
  const total = rows.reduce((sum, r) => sum + r.costUsd, 0);
  return rows.map((r) => ({
    category: r.category,
    label: categoryLabel(r.category as Category),
    costUsd: r.costUsd,
    tokens: r.tokens,
    sharePct: total > 0 ? (r.costUsd / total) * 100 : 0,
  }));
}

export function CategoryBreakdownBars({
  rows,
}: {
  rows: CategoryBreakdownBarRow[];
}) {
  const maxCost = Math.max(...rows.map((r) => r.costUsd), 0.000001);
  return (
    <VStack align="stretch" gap={3}>
      {rows.map((row) => {
        const widthPct = (row.costUsd / maxCost) * 100;
        return (
          <HStack key={row.category} gap={3}>
            <Text fontSize="sm" minWidth="160px">
              {row.label}
            </Text>
            <Tooltip
              openDelay={100}
              positioning={{ placement: "top" }}
              content={
                <VStack gap={0.5} align="start">
                  <Text fontWeight="semibold">{row.label}</Text>
                  <Text>{formatBudgetUsd(row.costUsd)}</Text>
                  <Text>{row.tokens.toLocaleString()} tokens</Text>
                </VStack>
              }
            >
              <Box
                flex={1}
                height="14px"
                backgroundColor="bg.muted"
                borderRadius="sm"
                overflow="hidden"
                position="relative"
                // Keyboard-focusable so the token count in the tooltip is
                // reachable without a pointer (the row shows cost + share
                // inline; tokens live only in the tooltip).
                tabIndex={0}
                cursor="default"
                aria-label={`${row.label}: ${formatBudgetUsd(
                  row.costUsd,
                )}, ${row.tokens.toLocaleString()} tokens`}
              >
                <Box
                  position="absolute"
                  left={0}
                  top={0}
                  height="full"
                  // Min visible width when the lane has DATA (tokens), not just
                  // cost — an unpriced/custom model has tokens but cost 0, which
                  // would otherwise render a 0-width bar that looks broken (the
                  // token count still shows in the tooltip + row).
                  width={`${Math.max(row.tokens > 0 || row.costUsd > 0 ? 2 : 0, widthPct)}%`}
                  backgroundColor="purple.400"
                />
              </Box>
            </Tooltip>
            <HStack gap={2} minWidth="120px" justifyContent="end" fontSize="sm">
              <Text>{formatBudgetUsd(row.costUsd)}</Text>
              <Text
                color="fg.subtle"
                fontSize="xs"
                minWidth="34px"
                textAlign="end"
              >
                {Math.round(row.sharePct)}%
              </Text>
            </HStack>
          </HStack>
        );
      })}
    </VStack>
  );
}

/**
 * Every category label, in taxonomy order, for the "Usage breakdown" caption's
 * (?) tooltip. Derived from the taxonomy so it can never drift; pinned to
 * CATEGORY_LABELS by the CategoryBreakdownBars test so a new category can't ship
 * without appearing in the tooltip (dev/docs/best_practices/copywriting.md — a
 * summarised list must be complete).
 */
export const CATEGORY_BREAKDOWN_TOOLTIP_LABELS: string[] =
  CATEGORIES.map(categoryLabel);

/**
 * One-line caption for the Usage breakdown section: a short summary of the
 * headline categories with a (?) tooltip carrying the complete list. Shared by
 * both surfaces so the summary phrasing stays identical.
 */
export function CategoryBreakdownCaption({
  scope = "personal",
}: {
  /** Whose usage this caption describes. The org Activity Monitor shows
   * aggregate org/team spend, so "your tokens" would be factually wrong there. */
  scope?: "personal" | "organization";
} = {}) {
  const lead =
    scope === "organization"
      ? "Where the organization’s tokens go"
      : "Where your tokens go";
  return (
    <HStack gap={1} color="fg.muted" fontSize="sm" marginBottom={3}>
      <Text>{lead}: system prompt, MCP tools, skills, thinking, and more.</Text>
      <Tooltip
        openDelay={100}
        content={
          <VStack gap={0.5} align="start">
            {CATEGORY_BREAKDOWN_TOOLTIP_LABELS.map((label) => (
              <Text key={label}>{label}</Text>
            ))}
          </VStack>
        }
      >
        <Box
          as="span"
          display="inline-flex"
          tabIndex={0}
          cursor="help"
          color="fg.subtle"
          aria-label="All content categories"
        >
          <HelpCircle size={14} />
        </Box>
      </Tooltip>
    </HStack>
  );
}

/**
 * Empty-state for the category breakdown when nothing was categorized in the
 * window. Neutral copy: it says what the customer would see here and when,
 * without pointing at a setting (categorization follows from content capture,
 * configured elsewhere per project) (dev/docs/best_practices/copywriting.md).
 */
export function CategoryBreakdownEnablementHint() {
  return (
    <Text fontSize="sm" color="fg.muted" paddingY={2}>
      No categorized coding-agent usage in this window yet. This view covers
      only coding-agent traffic captured with content, so it can stay empty even
      when your total AI spend is not.
    </Text>
  );
}

/**
 * Error-state for the category breakdown when the fetch itself failed. Kept
 * distinct from the enablement hint so a transport error never masquerades as
 * "no usage" (a false claim). Neutral, non-alarming copy in the same muted style
 * — the services already degrade ClickHouse failures to empty, so only rare
 * transport/500s reach here (dev/docs/best_practices/copywriting.md).
 */
export function CategoryBreakdownErrorHint() {
  return (
    <Text fontSize="sm" color="fg.muted" paddingY={2}>
      Couldn’t load the usage breakdown. Try again shortly.
    </Text>
  );
}
