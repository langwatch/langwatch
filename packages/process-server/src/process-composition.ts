import { TransportSelection } from "@langwatch/api/hosting/selection";
import type { SurfaceDefaultsOptions } from "@langwatch/api/policy";
import type { InstallableServerFeature } from "@langwatch/kernel";
import type { ProcessMemberSource } from "@langwatch/process-stores";
import {
  ConsumerPipelines,
  ProducerPipelines,
  type PipelineParticipation,
} from "@langwatch/process-stores/pipelines";

import type { ServedApplication } from "./server.ts";

export type ProcessModule = InstallableServerFeature<never> & {
  readonly publicConfig?: (config: unknown) => unknown;
};
export type ModuleBundle =
  | readonly ProcessModule[]
  | Readonly<{ chunks: readonly (readonly ProcessModule[])[] }>;
export interface ProcessBoot {
  readonly surfaceDefaults: SurfaceDefaultsOptions;
  boot(
    role: "api" | "worker",
    modules: readonly ProcessModule[],
    pipelines: PipelineParticipation,
    members: Readonly<Record<string, ProcessMemberFactory>>,
    transports?: TransportSelection,
  ): Promise<ServedApplication>;
}

/**
 * How a process builds a member of its own. Called once the stores are open,
 * so a supplied member may be composed over `prisma` or any other store.
 */
export type ProcessMemberFactory = (members: ProcessMemberSource) => unknown;

class Composition {
  protected modules: readonly ProcessModule[] = [];
  protected pipelines: PipelineParticipation | undefined;
  protected members: Record<string, ProcessMemberFactory> = {};
  protected constructor(protected readonly runtime: ProcessBoot) {}

  withModules(bundle: ModuleBundle): this {
    const modules = "chunks" in bundle ? bundle.chunks.flat() : bundle;
    this.modules = [...this.modules, ...modules];
    return this;
  }

  /**
   * One member this process answers itself, beyond what its stores supply.
   * A module claiming a name no store carries is answered here or refused
   * at boot by module and member. Built once the stores are open.
   */
  withMember(name: string, build: ProcessMemberFactory): this {
    this.members[name] = build;
    return this;
  }

  protected participation(): PipelineParticipation {
    if (!this.pipelines)
      throw new Error("pipelines must explicitly produce or consume before boot.");
    return this.pipelines;
  }
}

export class ApiProcessComposition extends Composition {
  #transports: TransportSelection | undefined;
  constructor(runtime: ProcessBoot) {
    super(runtime);
  }

  exposeTransports(build: (transports: TransportSelection) => TransportSelection): this {
    this.#transports = build(TransportSelection.create(this.runtime.surfaceDefaults));
    return this;
  }

  withPipelines(build: (pipelines: ProducerPipelines) => PipelineParticipation<"produce">): this {
    this.pipelines = build(new ProducerPipelines());
    if (this.pipelines.mode !== "produce") throw new Error("API pipelines can only produce.");
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
    return this.runtime.boot(
      "api",
      this.modules,
      this.participation(),
      this.members,
      this.#transports,
    );
  }
}

export class WorkerProcessComposition extends Composition {
  constructor(runtime: ProcessBoot) {
    super(runtime);
  }

  withPipelines(build: (pipelines: ConsumerPipelines) => PipelineParticipation<"consume">): this {
    this.pipelines = build(new ConsumerPipelines());
    if (this.pipelines.mode !== "consume") throw new Error("Worker pipelines must consume.");
    return this;
  }

  boot(): Promise<ServedApplication> {
    return this.runtime.boot("worker", this.modules, this.participation(), this.members);
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
