/**
 * What the query cost, from the server's own accounting.
 *
 * Rendered under the result in every mode, because the number of rows and the
 * bytes behind them are how a member tells an answer that is cheap to keep
 * running from one that needs narrowing — and that is as true of a chart as of
 * a table.
 *
 * Labels are spelled out ("rows returned", not "rows"), per
 * `dev/docs/best_practices/copywriting.md`; `ms`, `KB` and `MB` stay as symbols
 * because they are the standard ones.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 */

import { HStack, Text } from "@chakra-ui/react";

// Reused rather than reimplemented — the same rounding and the same unit
// symbols a member sees elsewhere in the product.
import { formatBytes } from "~/components/data-retention/format";
import type { GovernedSqlStatistics } from "~/server/analytics/governed-sql";
import { formatNumber } from "~/utils/formatNumber";

export interface GovernedSqlResultMetaProps {
  statistics: GovernedSqlStatistics;
}

export function GovernedSqlResultMeta({
  statistics,
}: GovernedSqlResultMetaProps) {
  return (
    <HStack
      gap={4}
      wrap="wrap"
      data-testid="governed-sql-result-summary"
      fontSize="11.5px"
      fontFamily="mono"
      paddingX={4}
      paddingY={2}
    >
      <Statistic
        value={formatNumber(statistics.rowsReturned)}
        label="rows returned"
      />
      <Statistic
        value={`${formatNumber(statistics.elapsedMs)} ms`}
        label="elapsed"
      />
      <Statistic value={formatNumber(statistics.rowsRead)} label="rows read" />
      <Statistic value={formatBytes(statistics.bytesRead)} label="bytes read" />
    </HStack>
  );
}

function Statistic({ value, label }: { value: string; label: string }) {
  return (
    <HStack gap={1} align="baseline">
      <Text fontWeight="medium">{value}</Text>
      <Text color="fg.muted">{label}</Text>
    </HStack>
  );
}
