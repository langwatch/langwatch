import { TransportSelection } from "@langwatch/api/hosting/selection";
import type { SurfaceDefaultsOptions } from "@langwatch/api/policy";
import type { ConfigOwner } from "@langwatch/config";
import {
  ConsumerPipelines,
  ProducerPipelines,
  type PipelineParticipation,
} from "@langwatch/process-stores/pipelines";

import type { InstallableServerFeature } from "./feature-installer.ts";
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
/** What one role boots: its modules, its pipelines' participation and, on the api, transports. */
export type ProcessBootInput = Readonly<{
  role: "api" | "worker" | "tasks";
  modules: readonly ProcessModule[];
  pipelines: PipelineParticipation;
  transports?: TransportSelection;
}>;

export interface ProcessBoot {
  readonly surfaceDefaults: SurfaceDefaultsOptions;
  boot(input: ProcessBootInput): Promise<BootedApplication>;
}

/** A container installs the modules its server's config named; the role decides its pipelines. */
class ProcessContainer {
  protected constructor(
    protected readonly runtime: ProcessBoot,
    protected readonly modules: readonly ProcessModule[],
  ) {}
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
    return this.runtime.boot({
      role: "api",
      modules: this.modules.map((module) => withOpenedSurfaces(module, selected)),
      pipelines: new ProducerPipelines().produce(),
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
    });
  }
}

/**
 * A module installs whatever surfaces this process selected; a transport for one it did
 * not select is skipped, never refused (§4 D3).
 */
function withOpenedSurfaces(
  module: ProcessModule,
  selected: TransportSelection["selected"],
): ProcessModule {
  const transports = module.transports ?? [];
  const opened = transports.filter((transport) => surfaceOpened(selected, transport.protocol));
  if (opened.length === transports.length) return module;
  return { ...module, transports: opened };
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
