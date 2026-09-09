// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { z } from "zod";
import type { IngestionPullRunProjection } from "~/generated/prisma/client";

export type PullRunSummary = Pick<
  IngestionPullRunProjection,
  "LastRunAt" | "LastRunOutcome" | "LastRunError"
>;
const progressSchema = z.object({
  startingAt: z.string().datetime(),
  watermark: z.string().datetime().nullish(),
  page: z.string().nullable(),
});

function iso(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function billingProgress(sourceType: string, cursor: unknown) {
  const unknownProgress = { backfillThrough: null, hasMore: null };
  if (sourceType !== "anthropic_admin" && sourceType !== "openai_admin")
    return unknownProgress;
  try {
    const parsed = progressSchema.safeParse(
      typeof cursor === "string" ? JSON.parse(cursor) : cursor,
    );
    if (!parsed.success) return unknownProgress;
    const hasMore = parsed.data.page !== null;
    return {
      backfillThrough: iso(
        hasMore ? parsed.data.watermark : parsed.data.startingAt,
      ),
      hasMore,
    };
  } catch {
    return unknownProgress;
  }
}

function failureMessage(error: string | null | undefined): string {
  if (/Too many simultaneous queries/i.test(error ?? ""))
    return "The database is busy.";
  if (/HTTP 429|rate limit exceeded/i.test(error ?? ""))
    return "The provider's request limit was reached.";
  return "The last pull failed.";
}

/** Only dates and a continuation flag leave the server, never opaque tokens or
 * upstream error bodies (which can contain credentials and provider payloads).
 * A watermark is the last bucket emitted, not a guarantee that history is complete.
 */
export function sourcePullStatus({
  sourceType,
  cursor,
  pullRun,
}: {
  sourceType: string;
  cursor: unknown;
  pullRun?: PullRunSummary | null;
}) {
  return {
    lastRunAt: iso(pullRun?.LastRunAt),
    outcome: pullRun?.LastRunOutcome ?? null,
    error:
      pullRun?.LastRunOutcome === "failed"
        ? failureMessage(pullRun.LastRunError)
        : null,
    ...billingProgress(sourceType, cursor),
  };
}
