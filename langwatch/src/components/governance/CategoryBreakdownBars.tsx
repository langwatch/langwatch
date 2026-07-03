import { Box, HStack, Link, Text, VStack } from "@chakra-ui/react";
import { formatBudgetUsd } from "~/components/gateway/formatBudgetUsd";
import { Tooltip } from "~/components/ui/tooltip";

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
                cursor="default"
              >
                <Box
                  position="absolute"
                  left={0}
                  top={0}
                  height="full"
                  width={`${Math.max(row.costUsd > 0 ? 2 : 0, widthPct)}%`}
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
 * Empty-state for the category breakdown when no content was captured
 * (ADR-033 Decision 7). Category numbers only exist when payload capture is on,
 * so the hint says what the customer must do and links to the settings.
 */
export function CategoryBreakdownEnablementHint({
  settingsHref,
}: {
  settingsHref: string;
}) {
  return (
    <VStack align="start" gap={1} paddingY={2}>
      <Text fontSize="sm" color="fg.muted">
        Turn on payload capture to see where your tokens go — which share is
        system prompt, MCP tools, skills, thinking, and more.
      </Text>
      <Link href={settingsHref} color="blue.600" fontSize="sm">
        Enable payload capture →
      </Link>
    </VStack>
  );
}
