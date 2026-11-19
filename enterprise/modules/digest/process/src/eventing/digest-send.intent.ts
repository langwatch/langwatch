// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The weekly plan's outbox side: carries one `planWeek` intent out, then prunes old plan rows.
 * Spec: enterprise/modules/digest/specs/digest.feature
 */
import { createLogger } from "@langwatch/observability";

import { DIGEST_PLAN_PROCESS_NAME, type PlanWeekIntent } from "./digest-send.process.ts";

const logger = createLogger("langwatch:digest");

/** Outbox rows are bookkeeping, one plan per wake, pruned after a week. */
const PLAN_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface DigestPlanRunDeps {
  /** The plan itself: idempotent, so a retried intent asks no member twice. */
  readonly planWeek: (input: PlanWeekIntent) => Promise<void>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

/** The prune is bookkeeping: a failed one waits for the next plan's, as billing's passes do. */
export function runDigestPlan(deps: DigestPlanRunDeps): (input: PlanWeekIntent) => Promise<void> {
  return async (input) => {
    await deps.planWeek(input);
    await deps
      .deleteDispatchedBefore({
        processName: DIGEST_PLAN_PROCESS_NAME,
        before: deps.now() - PLAN_ROW_RETENTION_MS,
      })
      .catch((error: unknown) => {
        logger.warn({ error }, "the digest plan's outbox rows could not be pruned");
        return 0;
      });
  };
}
