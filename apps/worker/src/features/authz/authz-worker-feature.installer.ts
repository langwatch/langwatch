import type { AuthzPipeline } from "@langwatch/authz-server";
import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** AuthZ's worker-facing capability: the built grants-ledger definition. */
export interface AuthzWorkerCapability {
  /**
   * The grants ledger's consumer half (ADR-092 §13).
   *
   * Built by the composition root from `PostgresAuthzPipelineAdapter` over the
   * one Prisma client this process opened: the read model's guarded writer and
   * the insert-only audit trail are both Postgres bindings, and one grant
   * event expands onto both heads through the same client.
   *
   * There is no `connect` half here any more. It hands a PRODUCER the senders
   * a registration produced, and this process writes no grants — the
   * application keeps its own `AuthzFeature.connect` for the writers it hosts.
   */
  readonly pipeline: AuthzPipeline;
}

/**
 * Worker registration for the AuthZ grants ledger (ADR-092 §13).
 *
 * It registers last, after every pipeline that can emit a grant change, for
 * the same reason the legacy registry did: the ledger is where a grant change
 * lands, and registering it before its producers exist would let a command
 * reach a ledger whose upstream pipelines had not been registered yet.
 *
 * It runs today: the legacy `PipelineRegistry` registers this pipeline as
 * well, and the two definitions are twins until the cutover — the application
 * keeps its own for the producer surface its request paths dispatch through,
 * and this graph is the consumer. Whoever makes the worker composition the
 * live one drops the legacy registration in the same change.
 */
export class AuthzWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  static create(options: {
    installer: AuthzWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): AuthzWorkerFeatureInstaller {
    return new AuthzWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "authz";
  private installed = false;

  private constructor(
    private readonly installer: AuthzWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      this.eventing.eventSourcing.register(this.installer.pipeline);
      this.installed = true;
    }
    return AuthzWorkerFeatureHandle.create();
  }
}

class AuthzWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): AuthzWorkerFeatureHandle {
    return new AuthzWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
