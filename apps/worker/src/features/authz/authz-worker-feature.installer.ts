import { EventingAuthzCommandDispatcherAdapter } from "@langwatch/authz-server";
import type { AuthzGrantsCommandSenders, AuthzPipeline } from "@langwatch/authz-server";
import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** AuthZ's worker-facing capability: one pipeline definition and its late binding. */
export interface AuthzWorkerCapability {
  readonly pipeline: AuthzPipeline;
  /**
   * Hands the grants ledger the command senders the registration produced.
   * Until this runs, an organization whose genesis import has landed has no
   * durable write path and the dispatcher rejects with a ledger-unavailable
   * error rather than silently taking the imperative Prisma path.
   */
  connect(commands: AuthzGrantsCommandSenders): void;
}

/**
 * Worker registration for the AuthZ grants ledger (ADR-092 §13).
 *
 * It registers last, after every pipeline that can emit a grant change, for
 * the same reason the legacy registry did: the ledger's write path is opened
 * by `connect`, and opening it before the producers exist would let a command
 * reach a ledger whose upstream pipelines had not been registered yet.
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
      const pipeline = this.eventing.eventSourcing.register(this.installer.pipeline);
      this.installer.connect(EventingAuthzCommandDispatcherAdapter.sendersFrom(pipeline.commands));
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
