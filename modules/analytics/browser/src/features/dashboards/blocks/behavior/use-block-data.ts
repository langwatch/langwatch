/**
 * A block's two reads through `analytics.lwql.query`: has its source ever
 * recorded a row, and its statements over the period. Separate queries, so
 * one panel retries alone (AC23).
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { analyticsApi } from "../../../../behavior/analytics-api.ts";
import { createLangWatchQLExecute } from "../../../../behavior/lwql-execute.ts";
import type { LangWatchQLExecute } from "../../../../model/lwql-request-controller.ts";
import {
  type BlockDefinition,
  type BlockSource,
  fitGranularity,
  type RequestStatus,
  SOURCE_EXISTENCE_SQL,
} from "../model/block-definition.ts";
import type { BlockPeriod, BlockRows } from "../model/block-format.ts";

/** Existence is about the project, not the period, so it is cached for a while. */
const SOURCE_STALE_MS = 5 * 60 * 1000;

function useExecute(projectId: string): LangWatchQLExecute {
  const utils = analyticsApi.useUtils();
  return useMemo(
    () =>
      createLangWatchQLExecute({
        transport: {
          mutate: (input, options) => utils.client.analytics.lwql.query.mutate(input, options),
        },
        projectId,
      }),
    [utils, projectId],
  );
}

export interface SourceConnection {
  readonly status: RequestStatus;
  readonly connected: boolean;
  readonly error: unknown;
  readonly retry: () => void;
}

/** Whether the source has ever recorded a row for this project. */
export function useSourceConnection({
  projectId,
  source,
}: {
  projectId: string;
  source: BlockSource;
}): SourceConnection {
  const execute = useExecute(projectId);
  const query = useQuery({
    queryKey: ["dashboard-blocks", "source", projectId, source],
    queryFn: ({ signal }) => execute({ sql: SOURCE_EXISTENCE_SQL[source] }, { signal }),
    staleTime: SOURCE_STALE_MS,
    retry: false,
  });
  return {
    status: query.status,
    connected: (query.data?.rows.length ?? 0) > 0,
    error: query.error,
    retry: () => void query.refetch(),
  };
}

export interface BlockData {
  readonly status: RequestStatus;
  readonly rows: BlockRows | undefined;
  readonly granularitySeconds: number;
  readonly error: unknown;
  readonly retry: () => void;
}

/** Runs every statement of one block over the period; sends nothing while `enabled` is false. */
export function useBlockData({
  projectId,
  block,
  period,
  enabled,
}: {
  projectId: string;
  block: BlockDefinition;
  period: BlockPeriod;
  enabled: boolean;
}): BlockData {
  const execute = useExecute(projectId);
  const { periodStart, periodEnd } = period;
  const granularitySeconds = fitGranularity({
    periodStart,
    periodEnd,
    requested: period.granularitySeconds,
  });
  const query = useQuery({
    queryKey: [
      "dashboard-blocks",
      "block",
      projectId,
      block.id,
      periodStart,
      periodEnd,
      granularitySeconds,
    ],
    enabled,
    retry: false,
    queryFn: async ({ signal }): Promise<BlockRows> => {
      const answers = await Promise.all(
        block.queries.map(async ({ name, sql }) => {
          const result = await execute(
            { sql, timeWindow: { start: periodStart, end: periodEnd }, granularitySeconds },
            { signal },
          );
          return [name, result.rows] as const;
        }),
      );
      return Object.fromEntries(answers);
    },
  });
  return {
    status: query.status,
    rows: query.data,
    granularitySeconds,
    error: query.error,
    retry: () => void query.refetch(),
  };
}
