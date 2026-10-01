// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  PULL_REFUSED_ERROR_CODE,
  type IngestionSourcePullStatus,
} from "@langwatch/enterprise-governance-contract";
import { Temporal } from "@langwatch/time";
import { z } from "zod";

import type { IngestionPullRunStatusData } from "../eventing/ingestion-pull-run-status-eventing.projection.ts";

export type PullRunSummary = Pick<
  IngestionPullRunStatusData,
  "LastRunAt" | "LastRunOutcome" | "LastRunError" | "LastRunErrorCode"
>;

const progressSchema = z.object({
  startingAt: z.iso.datetime(),
  watermark: z.iso.datetime().nullish(),
  page: z.string().nullable(),
});

const MILLISECONDS = { fractionalSecondDigits: 3 } as const;

/** Main's `Date#toISOString` spelling: milliseconds always present. */
function isoOfMillis(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toString(MILLISECONDS);
}

function isoOfTimestamp(timestamp: string): string {
  return Temporal.Instant.from(timestamp).toString(MILLISECONDS);
}

function parseCursor(cursor: unknown): unknown {
  if (typeof cursor !== "string") return cursor;
  try {
    return JSON.parse(cursor);
  } catch {
    return undefined;
  }
}

function billingProgress(
  sourceType: string,
  cursor: unknown,
): Pick<IngestionSourcePullStatus, "backfillThrough" | "hasMore"> {
  const unknownProgress = { backfillThrough: null, hasMore: null };
  if (sourceType !== "anthropic_admin" && sourceType !== "openai_admin") return unknownProgress;
  const parsed = progressSchema.safeParse(parseCursor(cursor));
  if (!parsed.success) return unknownProgress;
  const hasMore = parsed.data.page !== null;
  const through = hasMore ? parsed.data.watermark : parsed.data.startingAt;
  return { backfillThrough: through ? isoOfTimestamp(through) : null, hasMore };
}

/** The refused code is only written beside a sentence we wrote, so it alone is shown as written. */
function failureMessage(run: PullRunSummary): string {
  const error = run.LastRunError ?? "";
  if (run.LastRunErrorCode === PULL_REFUSED_ERROR_CODE && error) return error;
  if (/Too many simultaneous queries/i.test(error)) return "The database is busy.";
  if (/HTTP 429|rate limit exceeded/i.test(error))
    return "The provider's request limit was reached.";
  return "The last pull failed.";
}

/** Main's `sourcePullStatus`: dates and a continuation flag, never tokens or upstream bodies. */
export function sourcePullStatus({
  sourceType,
  cursor,
  pullRun,
}: {
  sourceType: string;
  cursor: unknown;
  pullRun: PullRunSummary | null;
}): IngestionSourcePullStatus {
  return {
    lastRunAt: pullRun?.LastRunAt == null ? null : isoOfMillis(pullRun.LastRunAt),
    outcome: pullRun?.LastRunOutcome ?? null,
    error: pullRun?.LastRunOutcome === "failed" ? failureMessage(pullRun) : null,
    ...billingProgress(sourceType, cursor),
  };
}
