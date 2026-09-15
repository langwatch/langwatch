import { EventingGithubMaintenanceAdapter } from "@langwatch/github-server";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/** The sweep, so a caller can supply one without a GitHub App or a database. */
export abstract class WorkerGithubBranchMaintenance {
  /** Re-asks GitHub about branches whose mapping is due; answers how many. */
  abstract recheckDueBranches(): Promise<number>;

  /** Drops branch bookkeeping past the activity horizon. */
  abstract pruneStaleBranchLinkage(): Promise<{ branchChecks: number }>;
}

/**
 * Worker registration for GitHub pull-request linkage maintenance. The pipeline
 * is built here (not received) so outbox rows are pruned by this graph's process store.
 */
export class GithubWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create(options: {
    eventing: WorkerEventingRuntime;
    branchMaintenance: WorkerGithubBranchMaintenance;
  }): GithubWorkerFeatureInstaller {
    return new GithubWorkerFeatureInstaller(options.eventing, options.branchMaintenance);
  }

  readonly name = "github";
  private installed = false;

  private constructor(
    private readonly eventing: WorkerEventingRuntime,
    private readonly branchMaintenance: WorkerGithubBranchMaintenance,
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.installed) {
      this.eventing.eventSourcing.register(
        EventingGithubMaintenanceAdapter.create({
          github: {
            recheckDueBranches: () => this.branchMaintenance.recheckDueBranches(),
            pruneStaleBranchLinkage: () => this.branchMaintenance.pruneStaleBranchLinkage(),
          },
          processStore: this.eventing.processStore,
        }).build(),
      );
      this.installed = true;
    }
    return undefined;
  }
}
