import { Text, VStack } from "@chakra-ui/react";
import type React from "react";

import { Tooltip } from "@langwatch/design-system/tooltip";
import { formatTokens } from "@langwatch/design-system/display-formatters";
import type { SessionListRow } from "../session-list-row";
import { MissingValue } from "./missing-value";

/**
 * How often the session had to throw context away, and how often it had to
 * pay for a cache it had already built. A session that did neither says so
 * with the same placeholder every other absent value uses.
 */
export const CompactionsCell: React.FC<{ row: SessionListRow }> = ({ row }) => {
  if (row.compactions === 0 && row.cacheRebuildCount === 0) {
    return <MissingValue />;
  }

  const explanations = [
    row.compactions > 0
      ? `Compacted from ${formatTokens(row.compactionTokensBefore)} to ${formatTokens(row.compactionTokensAfter)} tokens`
      : null,
    row.cacheRebuildCount > 0
      ? `Largest cache rebuild ${formatTokens(row.largestCacheRebuildTokens)} tokens`
      : null,
  ].filter((line): line is string => line !== null);

  return (
    <Tooltip
      content={
        <VStack align="start" gap={0.5}>
          {explanations.map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </VStack>
      }
      positioning={{ placement: "left" }}
    >
      <VStack align="start" gap={0} cursor="help" tabIndex={0}>
        {row.compactions > 0 ? (
          <Text fontSize="sm" whiteSpace="nowrap">
            {row.compactions} {row.compactions === 1 ? "compaction" : "compactions"}
          </Text>
        ) : null}
        {row.cacheRebuildCount > 0 ? (
          <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
            {row.cacheRebuildCount}{" "}
            {row.cacheRebuildCount === 1 ? "cache rebuild" : "cache rebuilds"}
          </Text>
        ) : null}
      </VStack>
    </Tooltip>
  );
};
