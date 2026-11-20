// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import {
  NurturingMemberBackfillService,
  type NurturingMemberBackfillPeers,
  type NurturingMemberBackfillTotals,
} from "../services/nurturing-member-backfill.service.ts";

const logger = createLogger("langwatch:task:nurturing-member-backfill");

export type NurturingMemberBackfillReport = NurturingMemberBackfillTotals & {
  /** True when the signal stopped the run, so the totals are partial. */
  aborted: boolean;
};

export type NurturingMemberBackfillOutcome = {
  dryRun: NurturingMemberBackfillReport;
  /** Null without `--execute`. */
  executed: NurturingMemberBackfillReport | null;
};

/**
 * Always a dry run first, so the counts a real run is about to write are printed before it
 * starts; `--execute` is required to write.
 * Spec: enterprise/modules/nurturing/specs/organization-member-facts.feature
 */
export async function runNurturingMemberBackfill({
  peers,
  execute,
  signal,
}: {
  peers: NurturingMemberBackfillPeers;
  execute: boolean;
  signal: AbortSignal;
}): Promise<NurturingMemberBackfillOutcome> {
  const service = NurturingMemberBackfillService.create({ peers });

  const dryRun = {
    ...(await service.backfill({ dryRun: true, signal })),
    aborted: signal.aborted,
  };
  logger.info(
    { report: dryRun },
    `Nurturing member backfill dry run: ${dryRun.created} members have no member-copy row; the plan resync will skip them until this runs with --execute`,
  );
  if (!execute) {
    logger.info("This is a dry run. Re-run with --execute to write.");
    return { dryRun, executed: null };
  }
  if (signal.aborted) {
    logger.info("Nurturing member backfill aborted after the dry run; nothing written.");
    return { dryRun, executed: null };
  }

  const executed = {
    ...(await service.backfill({ dryRun: false, signal })),
    aborted: signal.aborted,
  };
  logger.info({ report: executed }, "Nurturing member backfill wrote");
  return { dryRun, executed };
}

/**
 * The task-launcher entry: `pnpm task nurturing-member-backfill [--execute]`. Run after the
 * rollout; against production only with the owner's go.
 */
export class NurturingMemberBackfillTask extends Task {
  readonly name = "nurturing-member-backfill";
  readonly description =
    "Copies each organization's current members into nurturing's member copy. Dry run unless --execute.";

  private constructor(private readonly peers: NurturingMemberBackfillPeers) {
    super();
  }

  static create({ peers }: { peers: NurturingMemberBackfillPeers }): NurturingMemberBackfillTask {
    return new NurturingMemberBackfillTask(peers);
  }

  async run({ args, signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await runNurturingMemberBackfill({
      peers: this.peers,
      execute: args.includes("--execute"),
      signal,
    });
  }
}
