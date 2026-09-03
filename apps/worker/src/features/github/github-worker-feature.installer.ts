import { EventingGithubMaintenanceAdapter } from "@langwatch/github-server";
import type { WorkerFeatureCloser, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** The sweep, so a caller can supply one without a GitHub App or a database. */
export abstract class WorkerGithubBranchMaintenancePort {
  /** Re-asks GitHub about branches whose mapping is due; answers how many. */
  abstract recheckDueBranches(): Promise<number>;

  /** Drops branch bookkeeping past the activity horizon. */
  abstract pruneStaleBranchLinkage(): Promise<{ branchChecks: number }>;
}

/**
 * Worker registration for GitHub pull-request linkage maintenance.
 *
 * The sweep used to be a `setTimeout` chain booted on every replica with no
 * lock, so the fleet ran the same cross-tenant scan N times every ten minutes.
 * It is a scheduled process manager now, and the wake commit is what fences
 * racing workers.
 *
 * The pipeline is built HERE rather than received, for the same reason the
 * API-key sweep's is: the outbox rows the recheck writes have to be the ones
 * this graph's own process store prunes, and a definition built against another
 * store prunes another process's rows. What made that impossible until now was
 * the definition's dependency — the whole `GithubService`, an organization
 * service and a project service behind it — for two methods that read neither.
 */
export class GithubWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
  static create(options: {
    eventing: WorkerEventingRuntime;
    branchMaintenance: WorkerGithubBranchMaintenancePort;
  }): GithubWorkerFeatureInstaller {
    return new GithubWorkerFeatureInstaller(options.eventing, options.branchMaintenance);
  }

  readonly name = "github";
  private installed = false;

  private constructor(
    private readonly eventing: WorkerEventingRuntime,
    private readonly branchMaintenance: WorkerGithubBranchMaintenancePort,
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
