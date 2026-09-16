/**
 * What the query cost, from the server's own accounting: rows and bytes
 * are how a member tells a cheap answer from one that needs narrowing.
 * Labels spell out ("rows returned"); `ms`/`KB`/`MB` stay as symbols.
 */

import { HStack, Text } from "@chakra-ui/react";

// Reused rather than reimplemented — the same rounding and the same unit
// symbols a member sees elsewhere in the product.
import type { LangWatchQLStatistics } from "@langwatch/analytics-contract";
import { formatBytes, formatNumber } from "../../model/format.ts";

export interface LangWatchQLResultMetaProps {
  statistics: LangWatchQLStatistics;
}

export function LangWatchQLResultMeta({ statistics }: LangWatchQLResultMetaProps) {
  return (
    <HStack
      gap={4}
      wrap="wrap"
      data-testid="lwql-result-summary"
      fontSize="11.5px"
      fontFamily="mono"
      paddingX={4}
      paddingY={2}
    >
      <Statistic value={formatNumber(statistics.rowsReturned)} label="rows returned" />
      <Statistic value={`${formatNumber(statistics.elapsedMs)} ms`} label="elapsed" />
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
