/**
 * Everything the query service needs to run an eval function, in one dependency.
 *
 * Four facts, and each one belongs to a different part of the system: whether
 * the project may judge at all (a flag plus a configured classifier), which
 * judge to use, how hard to push it inside one query, and where the spend goes.
 * Bundling them is what keeps `lwql.service.ts` free of a Prisma import, a
 * feature-flag import and a pricing constant, and what lets a suite run the
 * whole eval path against a fake classifier with no datastore at all.
 *
 * @see ../../app-layer/instant-evals/classifier/classifier.ts
 * @see ../../app-layer/instant-evals/access.ts
 */

import { env } from "~/env.mjs";
import { tryGetApp } from "~/server/app-layer/app";
import { instantEvalsEnabled } from "~/server/app-layer/instant-evals/access";
import { getInstantEvalClassifier } from "~/server/app-layer/instant-evals/classifier";
import type { InstantEvalClassifier } from "~/server/app-layer/instant-evals/classifier/classifier";
import {
  type InstantEvalSpendRecord,
  type InstantEvalSpendRecorder,
  LoggingInstantEvalSpendRecorder,
} from "~/server/app-layer/instant-evals/instant-eval-spend.recorder";
import { prisma } from "~/server/db";

/**
 * Classifications one query keeps in flight.
 *
 * The token bucket paces the deployment, so this only has to be high enough
 * that the bucket, not the number of open requests, is what a query waits on.
 * At roughly 250 ms a call, 128 in flight is about five hundred a second,
 * which is the bucket's own rate on ordinary texts, and it clears the
 * thousand-key cap in a couple of seconds.
 */
const DEFAULT_MAX_CONCURRENCY = 128;

/**
 * Input tokens one synchronous query may send.
 *
 * Four million is about a hundred dollars of judgement at the shipped rate for
 * a caller who is *waiting* for it — far past the point where the same
 * statement belongs in a job. It is a ceiling on the surface, not on the
 * feature.
 */
const DEFAULT_QUERY_TOKEN_BUDGET = 4_000_000;

export interface LangWatchQLInstantEvalSupport {
  /**
   * Whether this caller may call an eval function at all.
   *
   * Takes the whole scope rather than one project because a key can read
   * several, and a judgement is charged to a project: a query spanning more
   * than one has no single owner for the spend, so it is refused. Within a
   * single-project scope this is the project's own flag.
   */
  isEnabled(args: { projectIds: readonly string[] }): Promise<boolean>;
  /** The judge, built on first use. */
  classifier(): InstantEvalClassifier;
  readonly maxConcurrency: number;
  readonly queryTokenBudget: number;
  recordSpend(record: InstantEvalSpendRecord): Promise<void>;
}

/**
 * The default wiring.
 *
 * `recorder` is the port rather than the class so a caller can hand in another
 * one. Left unset, the recorder is whichever the application container bound,
 * resolved at record time rather than here because this factory runs while the
 * container may still be under construction (ADR-093); a process with no
 * container falls back to the logging default.
 */
export function createLangWatchQLInstantEvalSupport({
  recorder,
  isProjectEnabled = (projectId: string) =>
    instantEvalsEnabled({ prisma, projectId }),
}: {
  recorder?: InstantEvalSpendRecorder;
  /**
   * Whether one project may judge, injectable so the scope rule below can be
   * stated in a test without a datastore behind it — the same reason
   * `instantEvalsEnabled` takes `isClassifierConfigured`.
   */
  isProjectEnabled?: (projectId: string) => Promise<boolean>;
} = {}): LangWatchQLInstantEvalSupport {
  const fallback = new LoggingInstantEvalSpendRecorder();
  return {
    isEnabled: async ({ projectIds }) => {
      // A judgement is charged to a project, so a scope that names anything
      // other than exactly one has no owner for the spend and is refused before
      // the flag is read at all.
      const only = projectIds.length === 1 ? projectIds[0] : undefined;
      if (only === undefined) return false;
      return await isProjectEnabled(only);
    },
    classifier: getInstantEvalClassifier,
    maxConcurrency: DEFAULT_MAX_CONCURRENCY,
    queryTokenBudget:
      env.INSTANT_EVAL_QUERY_TOKEN_BUDGET ?? DEFAULT_QUERY_TOKEN_BUDGET,
    recordSpend: async (record) => {
      const bound = recorder ?? tryGetApp()?.instantEvals.spend ?? fallback;
      await bound.recordSpend(record);
    },
  };
}
