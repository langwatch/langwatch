/**
 * Everything the query service needs to run an eval function, in one dependency.
 *
 * Four facts, and each one belongs to a different part of the system: whether
 * the project may judge at all (a flag plus a configured classifier), which
 * judge to use, how hard to push it inside one query, and where the bill goes.
 * Bundling them is what keeps `lwql.service.ts` free of a Prisma import, a
 * feature-flag import and a pricing constant, and what lets a suite run the
 * whole eval path against a fake classifier with no datastore at all.
 *
 * @see ../../app-layer/instant-evals/classifier/classifier.ts
 * @see ../../app-layer/instant-evals/access.ts
 */

import { env } from "~/env.mjs";
import { instantEvalsEnabled } from "~/server/app-layer/instant-evals/access";
import { getInstantEvalClassifier } from "~/server/app-layer/instant-evals/classifier";
import type { InstantEvalClassifier } from "~/server/app-layer/instant-evals/classifier/classifier";
import type {
  InstantEvalCostRecord,
  InstantEvalCostRecorder,
} from "~/server/app-layer/instant-evals/instant-eval-cost.recorder";
import { PrismaInstantEvalCostRecorder } from "~/server/app-layer/instant-evals/instant-eval-cost.recorder";
import { prisma } from "~/server/db";

/**
 * Classifications one query keeps in flight.
 *
 * The global limiter already paces the deployment, so this is about one
 * caller's share of it rather than about the provider's quota: 32 at roughly
 * 250 ms each clears the thousand-key cap in about eight seconds, which is what
 * makes the synchronous loop feel instant.
 */
const DEFAULT_MAX_CONCURRENCY = 32;

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
   * than one has no single owner for the bill, so it is refused. Within a
   * single-project scope this is the project's own flag.
   */
  isEnabled(args: { projectIds: readonly string[] }): Promise<boolean>;
  /** The judge, built on first use. */
  classifier(): InstantEvalClassifier;
  readonly maxConcurrency: number;
  readonly queryTokenBudget: number;
  recordCost(record: InstantEvalCostRecord): Promise<void>;
}

/**
 * The default wiring, and the only place a concrete recorder is named.
 *
 * `recorder` is the port rather than the class so a caller can hand in another
 * one, and so the default is chosen here — in the factory whose job is wiring
 * — instead of being reached for from inside the query service.
 */
export function createLangWatchQLInstantEvalSupport({
  recorder = new PrismaInstantEvalCostRecorder(prisma),
  isProjectEnabled = (projectId: string) =>
    instantEvalsEnabled({ prisma, projectId }),
}: {
  recorder?: InstantEvalCostRecorder;
  /**
   * Whether one project may judge, injectable so the scope rule below can be
   * stated in a test without a datastore behind it — the same reason
   * `instantEvalsEnabled` takes `isClassifierConfigured`.
   */
  isProjectEnabled?: (projectId: string) => Promise<boolean>;
} = {}): LangWatchQLInstantEvalSupport {
  return {
    isEnabled: async ({ projectIds }) => {
      // A judgement is charged to a project, so a scope that names anything
      // other than exactly one has no owner for the bill and is refused before
      // the flag is read at all.
      const only = projectIds.length === 1 ? projectIds[0] : undefined;
      if (only === undefined) return false;
      return await isProjectEnabled(only);
    },
    classifier: getInstantEvalClassifier,
    maxConcurrency: DEFAULT_MAX_CONCURRENCY,
    queryTokenBudget:
      env.INSTANT_EVAL_QUERY_TOKEN_BUDGET ?? DEFAULT_QUERY_TOKEN_BUDGET,
    recordCost: async (record) => {
      await recorder.recordCost(record);
    },
  };
}
