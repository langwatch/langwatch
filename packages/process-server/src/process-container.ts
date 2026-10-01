import { TransportSelection } from "@langwatch/api/hosting/selection";
import type { SurfaceDefaultsOptions } from "@langwatch/api/policy";
import type { ConfigOwner } from "@langwatch/config";
import type { InstallableServerFeature } from "@langwatch/kernel";
import type { ProcessMemberSource } from "@langwatch/process-stores";
import {
  ConsumerPipelines,
  ProducerPipelines,
  type PipelineParticipation,
} from "@langwatch/process-stores/pipelines";

import type { ServedApplication } from "./server.ts";

export type ProcessModule = InstallableServerFeature<never> & {
  readonly publicConfig?: (config: unknown, api: unknown) => unknown;
};
/** An owner the server's config named that is also an installable module. */
export function isProcessModule(owner: ConfigOwner): owner is ProcessModule {
  return "install" in owner && typeof owner.install === "function";
}
/** A booted application: the server hosts it, and only the tasks role answers `tasks` (§9). */
export type BootedApplication = ServedApplication &
  Readonly<{
    tasks<Task>(isTask: (contribution: unknown) => contribution is Task): readonly Task[];
  }>;
/** What one role boots: its modules, its pipelines' participation, and what it supplies. */
export type ProcessBootInput = Readonly<{
  role: "api" | "worker" | "tasks";
  modules: readonly ProcessModule[];
  pipelines: PipelineParticipation;
  members: Readonly<Record<string, ProcessMemberFactory>>;
  transports?: TransportSelection;
}>;

export interface ProcessBoot {
  readonly surfaceDefaults: SurfaceDefaultsOptions;
  boot(input: ProcessBootInput): Promise<BootedApplication>;
}

/**
 * How a process builds a member of its own. Called once the stores are open,
 * so a supplied member may be composed over `prisma` or any other store.
 */
export type ProcessMemberFactory = (members: ProcessMemberSource) => unknown;

/** A container installs the modules its server's config named; the role decides its pipelines. */
class ProcessContainer {
  protected members: Record<string, ProcessMemberFactory> = {};
  protected constructor(
    protected readonly runtime: ProcessBoot,
    protected readonly modules: readonly ProcessModule[],
  ) {}

  /**
   * One member this process answers itself, beyond what its stores supply.
   * A module claiming a name no store carries is answered here or refused
   * at boot by module and member. Built once the stores are open.
   */
  withMember(name: string, build: ProcessMemberFactory): this {
    this.members[name] = build;
    return this;
  }
}

export class ApiProcessContainer extends ProcessContainer {
  #transports: TransportSelection | undefined;
  constructor(runtime: ProcessBoot, modules: readonly ProcessModule[]) {
    super(runtime, modules);
  }

  exposeTransports(build: (transports: TransportSelection) => TransportSelection): this {
    this.#transports = build(TransportSelection.create(this.runtime.surfaceDefaults));
    return this;
  }

  boot(): Promise<ServedApplication> {
    if (!this.#transports)
      throw new Error("surface must be selected with exposeTransports before boot.");
    const selected = this.#transports.selected;
    for (const module of this.modules) {
      for (const transport of module.transports ?? []) {
        if (!surfaceOpened(selected, transport.protocol))
          throw new Error(`${module.name} needs surface.${transport.protocol}.`);
      }
    }
    return this.runtime.boot({
      role: "api",
      modules: this.modules,
      pipelines: new ProducerPipelines().produce(),
      members: this.members,
      transports: this.#transports,
    });
  }
}

export class WorkerProcessContainer extends ProcessContainer {
  constructor(runtime: ProcessBoot, modules: readonly ProcessModule[]) {
    super(runtime, modules);
  }

  boot(): Promise<ServedApplication> {
    return this.runtime.boot({
      role: "worker",
      modules: this.modules,
      pipelines: new ConsumerPipelines().consume(),
      members: this.members,
    });
  }
}

/** One-shot work over the installed modules: sends commands, hosts no consumer (§9). */
export class TasksProcessContainer extends ProcessContainer {
  constructor(runtime: ProcessBoot, modules: readonly ProcessModule[]) {
    super(runtime, modules);
  }

  boot(): Promise<BootedApplication> {
    return this.runtime.boot({
      role: "tasks",
      modules: this.modules,
      pipelines: new ProducerPipelines().produce(),
      members: this.members,
    });
  }
}

/** A socket rides the process's one upgrade router, which every api process opens. */
function surfaceOpened(
  selected: TransportSelection["selected"],
  protocol: NonNullable<ProcessModule["transports"]>[number]["protocol"],
): boolean {
  if (protocol === "rest") return selected.rest !== undefined;
  if (protocol === "trpc") return selected.trpc !== undefined;
  return true;
}
