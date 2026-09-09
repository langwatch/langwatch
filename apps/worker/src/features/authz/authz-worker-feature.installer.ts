import { EventingAuthzCommandDispatcherAdapter, type AuthzPipeline } from "@langwatch/authz-server";
import type {
  WorkerFeatureCloser,
  WorkerFeatureInstallerPort,
} from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/** AuthZ's worker-facing capability: the built grants-ledger definition. */
export interface AuthzWorkerCapability {
  /** Shared ledger definition and the dispatcher held by the worker Authz App. */
  readonly pipeline: AuthzPipeline;
  readonly dispatcher?: EventingAuthzCommandDispatcherAdapter;
}

/** Registers the ledger before connecting the worker's grant commands. */
export class AuthzWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
  static create(options: {
    installer: AuthzWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): AuthzWorkerFeatureInstaller {
    return new AuthzWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "authz";
  #installed = false;
  readonly #installer: AuthzWorkerCapability;
  readonly #eventing: WorkerEventingRuntime;

  private constructor(installer: AuthzWorkerCapability, eventing: WorkerEventingRuntime) {
    this.#installer = installer;
    this.#eventing = eventing;
  }

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.#installed) {
      const registered = this.#eventing.eventSourcing.register(this.#installer.pipeline);
      this.#installer.dispatcher?.connect(
        EventingAuthzCommandDispatcherAdapter.sendersFrom(registered.commands),
      );
      this.#installed = true;
    }
    return void 0;
  }
}
