/**
 * The boundary that keeps Vega out of every bundle but this one.
 *
 * Vega, Vega-Lite, vega-embed and the generated schema validator are several
 * megabytes that only a member who opens Chart mode ever needs. Everything that
 * reaches them is behind this one lazy import, so the workbench page, Table
 * mode, and every unrelated route load none of it.
 *
 * Mount this, not `GovernedSqlChartMode` — importing that directly is what
 * would put Vega back in the entry chunk, and nothing would look wrong.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 */

import { HStack, Spinner, Text } from "@chakra-ui/react";

import dynamic from "~/utils/compat/next-dynamic";

import type { GovernedSqlChartModeProps } from "./GovernedSqlChartMode";

export type {
  GovernedSqlChartModeProps,
  GovernedSqlChartResult,
} from "./GovernedSqlChartMode";

export const LazyGovernedSqlChartMode = dynamic<GovernedSqlChartModeProps>(
  () => import("./GovernedSqlChartMode"),
  {
    ssr: false,
    loading: () => (
      <HStack gap={2} color="fg.muted" padding={4}>
        <Spinner size="sm" />
        <Text fontSize="13px">Loading the chart</Text>
      </HStack>
    ),
  },
);
