/**
 * A block's two reads: whether its source has ever recorded a row, answered
 * for every source at once by `dashboards.sourcePresence`, and its statements
 * over the period through `analytics.lwql.query`, one query per block (AC23).
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
} from "../model/block-definition.ts";
import type { BlockPeriod, BlockRows } from "../model/block-format.ts";

/** Presence is about the project, not the period, so it is cached for a while. */
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

/**
 * Whether the source has ever recorded a row. Every block reads the same one
 * call, so a board asks once; a source the server could not check is an
 * error with a retry, never the call to action (AC7, AC25).
 */
export function useSourceConnection({
  projectId,
  source,
}: {
  projectId: string;
  source: BlockSource;
}): SourceConnection {
  const presence = analyticsApi.dashboards.sourcePresence.useQuery(
    { projectId },
    { enabled: !!projectId, staleTime: SOURCE_STALE_MS, retry: false },
  );
  const retry = () => void presence.refetch();
  if (presence.status !== "success") {
    return { status: presence.status, connected: false, error: presence.error, retry };
  }
  const state = presence.data[source];
  if (state === "failed") return { status: "error", connected: false, error: null, retry };
  return { status: "success", connected: state === "present", error: null, retry };
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
