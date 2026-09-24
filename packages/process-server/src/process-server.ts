import { WebSocketHost } from "@langwatch/api";
import type { TransportSelection } from "@langwatch/api/hosting";
import type { SurfaceDefaultsOptions } from "@langwatch/api/policy";
import {
  bootInstalledProcess,
  storesBackedMembers,
  type ExposedSurface,
  type TransportPeers,
} from "@langwatch/kernel";
import { resourceAttributesFrom } from "@langwatch/observability/node";
import {
  MEMBER_NAMES,
  hostedMembers,
  openProcessStores,
  type ProcessMemberSource,
} from "@langwatch/process-stores";
import { storesOwner, type StoresConfig } from "@langwatch/process-stores/config";
import type { PipelineParticipation } from "@langwatch/process-stores/pipelines";
import type { SecretsResolver } from "@langwatch/secrets";
import { z } from "zod";

import {
  ApiProcessComposition,
  WorkerProcessComposition,
  type ProcessBoot,
  type ProcessMemberFactory,
  type ProcessModule,
} from "./process-composition.ts";
import {
  Server,
  type ServedApplication,
  type ServerContribution,
  type ServerLogger,
} from "./server.ts";
import { assetBaseOrigin, normalizeAssetBase } from "./transport/asset-base.ts";
import { apiOwner, type ApiHostConfig } from "./transport/config-owner.ts";
import { processSurface } from "./transport/process-surface.ts";

type ParsedConfig = Readonly<Record<string, unknown>>;

export class ProcessServer implements ProcessBoot {
  static create(options: {
    name: string;
    logger: ServerLogger;
    config: ParsedConfig;
    resolver: SecretsResolver;
    healthPort?: number;
    ownsProcess?: boolean;
  }): ProcessServer {
    const settings = processSettings.parse(options.config.process ?? {});
    const server = Server.create({
      name: options.name,
      logger: options.logger,
      ownsProcess: options.ownsProcess,
      healthPort: options.healthPort ?? settings.port,
      shutdownDeadlineMs: settings.shutdownDeadlineMs,
    });
    return new ProcessServer({
      server,
      config: options.config,
      resolver: options.resolver,
      settings,
    });
  }

  private readonly server: Server;
  readonly config: ParsedConfig;
  private readonly resolver: SecretsResolver;
  private readonly settings: z.infer<typeof processSettings>;

  private constructor(deps: {
    server: Server;
    config: ParsedConfig;
    resolver: SecretsResolver;
    settings: z.infer<typeof processSettings>;
  }) {
    this.server = deps.server;
    this.config = deps.config;
    this.resolver = deps.resolver;
    this.settings = deps.settings;
  }

  get surfaceDefaults(): SurfaceDefaultsOptions {
    if (!this.config.http)
      throw new Error("The HTTP config owner must be installed before exposing transports.");
    const config = this.config.http as ApiHostConfig;
    return {
      production: this.production,
      assetOrigin: assetBaseOrigin(normalizeAssetBase(config.assetBase)),
    };
  }

  with(contribution: ServerContribution): this {
    this.server.with(contribution);
    return this;
  }

  composeProcess(role: "api"): ApiProcessComposition;
  composeProcess(role: "worker"): WorkerProcessComposition;
  composeProcess(role: "api" | "worker"): ApiProcessComposition | WorkerProcessComposition {
    if (role === "api") return new ApiProcessComposition(this);
    return new WorkerProcessComposition(this);
  }

  async boot(
    role: "api" | "worker",
    modules: readonly ProcessModule[],
    pipelines: PipelineParticipation,
    suppliedMembers: Readonly<Record<string, ProcessMemberFactory>> = {},
    transports?: TransportSelection,
  ): Promise<ServedApplication> {
    if (!this.config.stores)
      throw new Error("The stores config owner must be installed before boot.");
    const config = this.config.stores as StoresConfig;
    const secrets = this.resolver.scopeTo(storesOwner.name, Object.values(storesOwner.secrets));
    let members: ProcessMemberSource | undefined;
    try {
      const opened = await openProcessStores({
        name: this.server.name,
        config,
        secrets,
        pipelines,
        production: this.production,
      });
      members = opened;
      let surface: ((peers: TransportPeers) => ExposedSurface<unknown, unknown>) | undefined;
      if (role === "api" && transports) {
        const sockets = WebSocketHost.create();
        surface = await processSurface({
          config: this.config.http as ApiHostConfig,
          production: this.production,
          executionProxyBaseUrl: this.settings.nlpServiceUrl,
          members,
          secrets: this.resolver.scopeTo(apiOwner.name, Object.values(apiOwner.secrets)),
          selection: transports,
          publicConfig: this.publicConfig(modules),
          sockets,
        });
        this.server.with(sockets);
      }
      const runtime = await bootInstalledProcess({
        role,
        modules,
        config: this.config,
        // A module resolves only the handles it declared; `seal()` below then
        // refuses every resolve attempted after boot.
        secrets: (owner, declared) => this.resolver.scopeTo(owner, declared),
        // The stores answer the declared members; what this process composed
        // itself overrides them and extends the order, so a module naming a
        // member no store carries is answered rather than refused at boot.
        members: {
          ...storesBackedMembers(
            {
              order: MEMBER_NAMES,
              read(name) {
                const member = MEMBER_NAMES.find((candidate) => candidate === name);
                if (!member) throw new Error(`No process member named "${name}" is declared.`);
                return opened.read(member);
              },
            },
            {
              // A process fact, not a module one: every module that links back
              // to the product reads it here rather than declaring `BASE_HOST`.
              publicBaseUrl: this.settings.baseHost,
              serviceVersion: serviceVersionOf(this.config.observability),
              nodeEnvironment: this.settings.nodeEnvironment,
              isSaas: this.settings.isSaas ?? false,
              nlpServiceUrl: this.settings.nlpServiceUrl,
              adminEmails: this.settings.adminEmails ?? [],
              // Role facts: the composition's word, never a deployment's.
              processName: this.server.name,
              producesPipelines: pipelines.mode === "produce",
              ...Object.fromEntries(
                Object.entries(suppliedMembers).map(([name, build]) => [name, build(opened)]),
              ),
            },
          ),
          close: () => opened.close(),
        },
        ...(surface ? { surface } : {}),
      });
      this.server.with(hostedMembers(members));
      return runtime;
    } catch (error) {
      await members?.close();
      throw error;
    } finally {
      this.resolver.seal();
    }
  }

  /** Derived, not declared: `NODE_ENV` has one owner, the process slice. */
  private get production(): boolean {
    return this.settings.nodeEnvironment === "production";
  }

  private publicConfig(modules: readonly ProcessModule[]): Readonly<Record<string, unknown>> {
    const projected: Record<string, unknown> = {};
    for (const module of modules) {
      if (module.publicConfig)
        projected[module.name] = module.publicConfig(this.config[module.name]);
    }
    return projected;
  }

  serve(application: ServedApplication): Promise<void> {
    return this.server.serve(application);
  }
  run(application: ServedApplication): Promise<void> {
    return this.server.run(application);
  }
  close(): Promise<void> {
    return this.server.close();
  }
}

const releaseSettings = z.object({
  serviceVersion: z.string().optional(),
  resourceAttributes: z.string().optional(),
});

/**
 * The release this install runs, as the license sync, usage report and checkup
 * name it: `SERVICE_VERSION`, then `service.version` in
 * `OTEL_RESOURCE_ATTRIBUTES`, and `unknown` rather than a number made up here.
 */
export function serviceVersionOf(observability: unknown): string {
  const settings = releaseSettings.parse(observability ?? {});
  const explicit = settings.serviceVersion?.trim();
  if (explicit) return explicit;
  const attribute = resourceAttributesFrom(settings.resourceAttributes)["service.version"];
  return attribute || "unknown";
}

const processSettings = z.object({
  port: z.number().int().min(0).max(65535).default(0),
  shutdownDeadlineMs: z.number().int().positive().optional(),
  baseHost: z.string().optional(),
  nodeEnvironment: z.string().optional(),
  isSaas: z.boolean().optional(),
  nlpServiceUrl: z.string().optional(),
  adminEmails: z.array(z.string()).optional(),
});
