// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import {
  CustomerIoPlanResyncService,
  type CustomerIoPlanResyncPeers,
  type CustomerIoPlanResyncTotals,
} from "../services/customer-io-plan-resync.service.ts";

const logger = createLogger("langwatch:task:customer-io-plan-resync");

export type CustomerIoPlanResyncReport = CustomerIoPlanResyncTotals & {
  afterOrganizationId: string | null;
  dryRun: boolean;
  /** True when the signal stopped the run, so the totals are partial. */
  aborted: boolean;
};

export type CustomerIoPlanResyncOutcome = {
  dryRun: CustomerIoPlanResyncReport;
  /** Null without `--execute`. */
  executed: CustomerIoPlanResyncReport | null;
};

/**
 * Records each organization's plan and active members again, so nurturing sends them to
 * Customer.io. Run it after the deploy's member replay steps
 * (`nurturing:replay-organization-members`, `nurturing:replay-auth-members`) are done. If this
 * runs first, nurturing identifies no member without a member-copy row (the org's group call
 * still carries the plan), so the wrong order sends nothing wrong. To repair it, let the replay
 * finish, then re-run this; skipped members otherwise get no plan until the next live fact.
 * Always a dry run first, so the totals a real run is about to send are printed
 * before it starts; `--execute` is required to record.
 * Spec: enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
export async function runCustomerIoPlanResync({
  peers,
  execute,
  signal,
}: {
  peers: CustomerIoPlanResyncPeers;
  execute: boolean;
  signal: AbortSignal;
}): Promise<CustomerIoPlanResyncOutcome> {
  const resync = CustomerIoPlanResyncService.create({ peers });
  const run = async (dryRun: boolean): Promise<CustomerIoPlanResyncReport> => {
    const totals = await resync.resync({
      // No resume: a re-run records every organization again; each catch-up is stamped fresh, so a re-run re-sends every organization (same values: safe, not free).
      dryRun,
      signal,
      onPage: async ({ afterOrganizationId }) =>
        logger.info({ afterOrganizationId }, "Recorded a page of organizations"),
    });
    return { ...totals, dryRun, aborted: signal.aborted };
  };

  const dryRunReport = await run(true);
  logger.info({ report: dryRunReport }, "Customer.io plan resync dry run");
  if (!execute) {
    logger.info("This is a dry run. Re-run with --execute to record.");
    return { dryRun: dryRunReport, executed: null };
  }

  if (signal.aborted) {
    logger.info("Customer.io plan resync aborted after the dry run; nothing recorded.");
    return { dryRun: dryRunReport, executed: null };
  }

  const executedReport = await run(false);
  logger.info({ report: executedReport }, "Customer.io plan resync recorded");
  return { dryRun: dryRunReport, executed: executedReport };
}

/**
 * The task-launcher entry — `pnpm task customer-io-plan-resync [--execute]`. Run after the
 * rollout; against production only with the owner's go.
 */
export class CustomerIoPlanResyncTask extends Task {
  readonly name = "customer-io-plan-resync";
  readonly description =
    "Records each organization's plan and members again for Customer.io. Dry run unless --execute.";

  private constructor(private readonly peers: CustomerIoPlanResyncPeers) {
    super();
  }

  static create({ peers }: { peers: CustomerIoPlanResyncPeers }): CustomerIoPlanResyncTask {
    return new CustomerIoPlanResyncTask(peers);
  }

  async run({ args, signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await runCustomerIoPlanResync({
      peers: this.peers,
      execute: args.includes("--execute"),
      signal,
    });
  }
}
