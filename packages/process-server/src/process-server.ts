import { RawHttpHost, RawSocketHost, WebSocketHost } from "@langwatch/api";
import type { SurfaceDefaultsOptions } from "@langwatch/api/policy";
import {
  bootInstalledProcess,
  ModuleApiToken,
  storesBackedMembers,
  type ExposedSurface,
  type TransportPeers,
} from "@langwatch/kernel";
import { otlpHeadersFrom, resourceAttributesFrom } from "@langwatch/observability/node";
import { OperatorReadsResolver } from "@langwatch/prisma-client";
import {
  MEMBER_NAMES,
  hostedMembers,
  openProcessStores,
  type ProcessMemberSource,
} from "@langwatch/process-stores";
import { storesOwner, type StoresConfig } from "@langwatch/process-stores/config";
import type { SecretsResolver } from "@langwatch/secrets";
import { z } from "zod";

import { observabilityOwner } from "./observability-owner.ts";
import {
  ApiProcessContainer,
  TasksProcessContainer,
  WorkerProcessContainer,
  type ProcessBoot,
  type ProcessBootInput,
  type BootedApplication,
} from "./process-container.ts";
import {
  Server,
  type ServedApplication,
  type ServerContribution,
  type ServerLogger,
} from "./server.ts";
import { assetBaseOrigin, normalizeAssetBase } from "./transport/asset-base.ts";
import { projectPublicConfig } from "./transport/bundle-config.ts";
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

  container(role: "api"): ApiProcessContainer;
  container(role: "worker"): WorkerProcessContainer;
  container(role: "tasks"): TasksProcessContainer;
  container(
    role: "api" | "worker" | "tasks",
  ): ApiProcessContainer | WorkerProcessContainer | TasksProcessContainer {
    if (role === "api") return new ApiProcessContainer(this);
    if (role === "tasks") return new TasksProcessContainer(this);
    return new WorkerProcessContainer(this);
  }

  async boot({
    role,
    modules,
    pipelines,
    members: suppliedMembers,
    transports,
  }: ProcessBootInput): Promise<BootedApplication> {
    if (!this.config.stores)
      throw new Error("The stores config owner must be installed before boot.");
    const config = this.config.stores as StoresConfig;
    const secrets = this.resolver.scopeTo(storesOwner.name, Object.values(storesOwner.secrets));
    let members: ProcessMemberSource | undefined;
    let operatorReads: OperatorReadsResolver | undefined;
    try {
      const telemetryExporter = await this.resolver
        .scopeTo(observabilityOwner.name, Object.values(observabilityOwner.secrets))
        .into(observabilityOwner.secrets.otlpHeaders, (rawHeaders) =>
          telemetryExporterOf({ observability: this.config.observability, rawHeaders }),
        );
      const stores = await openProcessStores({
        name: this.server.name,
        config,
        secrets,
        pipelines,
        production: this.production,
      });
      const opened = stores.members;
      members = opened;
      // The mint stays here: only the root scopes it, per module, and seals it below.
      const operatorReadsResolver = OperatorReadsResolver.over({ mint: stores.operatorReads });
      operatorReads = operatorReadsResolver;
      let surface: ((peers: TransportPeers) => ExposedSurface<unknown, unknown>) | undefined;
      let doors: RawHttpHost | undefined;
      const page: Record<string, unknown> = {};
      if (role === "api" && transports) {
        const sockets = WebSocketHost.create();
        doors = RawHttpHost.create();
        surface = await processSurface({
          config: this.config.http as ApiHostConfig,
          production: this.production,
          executionProxyBaseUrl: this.settings.nlpServiceUrl,
          publicBaseUrl: this.settings.baseHost,
          members,
          secrets: this.resolver.scopeTo(apiOwner.name, Object.values(apiOwner.secrets)),
          selection: transports,
          publicConfig: page,
          sockets,
          doors,
        });
        this.server.with(sockets);
      }
      if (role === "worker") {
        const doors = RawSocketHost.create({ port: this.settings.rawSocketPort });
        surface = () => ({ hosts: { rawsocket: doors }, serve: () => void 0 });
        this.server.with({
          name: "raw socket doors",
          start: async () => {
            await doors.listen();
          },
          stop: () => doors.close(),
        });
      }
      const runtime = await bootInstalledProcess({
        role,
        modules,
        config: this.config,
        // A module resolves only the handles it declared; `seal()` below then
        // refuses every resolve attempted after boot.
        secrets: (owner, declared) => this.resolver.scopeTo(owner, declared),
        operatorReads: (scope) => operatorReadsResolver.scopeTo(scope),
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
              // Observability's OTLP collector, for the module still forwarding to it (rum).
              telemetryExporter,
              nodeEnvironment: this.settings.nodeEnvironment,
              isSaas: this.settings.isSaas ?? false,
              nlpServiceUrl: this.settings.nlpServiceUrl,
              nlpCodeBlockTimeoutSeconds: this.settings.nlpCodeBlockTimeoutSeconds,
              adminEmails: this.settings.adminEmails ?? [],
              // The raw-socket door's port, which a module tunnelling to that door reads.
              rawSocketPort: this.settings.rawSocketPort,
              // Role facts: the composition's word, never a deployment's.
              processName: this.server.name,
              ...Object.fromEntries(
                Object.entries(suppliedMembers).map(([name, build]) => [name, build(opened)]),
              ),
            },
          ),
          close: () => opened.close(),
        },
        ...(surface ? { surface } : {}),
      });
      if (role === "api") {
        Object.assign(
          page,
          await projectPublicConfig({
            modules,
            config: this.config,
            runningApi: (contract) =>
              contract instanceof ModuleApiToken ? runtime.service(contract) : void 0,
          }),
        );
      }
      this.server.with(hostedMembers(members));
      // Hosted after the members, so the doors close their sessions while the stores are open.
      const hosted = doors;
      if (hosted) this.server.with({ name: "raw http doors", stop: () => hosted.close() });
      return runtime;
    } catch (error) {
      await members?.close();
      throw error;
    } finally {
      this.resolver.seal();
      operatorReads?.seal();
    }
  }

  /** Derived, not declared: `NODE_ENV` has one owner, the process slice. */
  private get production(): boolean {
    return this.settings.nodeEnvironment === "production";
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

const exporterSettings = z.object({ otlpEndpoint: z.string().optional() });

/** OTLP collector headers, applied inside a build and never handed out as a value (ADR-132). */
type TelemetryExporterHeaders = <Out>(
  build: (headers: Readonly<Record<string, string>>) => Out,
) => Out;

/** Where this process exports OTLP, as observability owns it: `OTEL_EXPORTER_OTLP_*`. */
type TelemetryExporter = Readonly<{
  endpoint: string | undefined;
  withHeaders: TelemetryExporterHeaders;
}>;

export function telemetryExporterOf({
  observability,
  rawHeaders,
}: Readonly<{ observability: unknown; rawHeaders: string | undefined }>): TelemetryExporter {
  const headers = otlpHeadersFrom(rawHeaders);
  return {
    endpoint: exporterSettings.parse(observability ?? {}).otlpEndpoint,
    withHeaders: (build) => build(headers),
  };
}

const processSettings = z.object({
  port: z.number().int().min(0).max(65535).default(0),
  shutdownDeadlineMs: z.number().int().positive().optional(),
  baseHost: z.string().optional(),
  nodeEnvironment: z.string().optional(),
  isSaas: z.boolean().optional(),
  nlpServiceUrl: z.string().optional(),
  nlpCodeBlockTimeoutSeconds: z.string().optional(),
  adminEmails: z.array(z.string()).optional(),
  rawSocketPort: z.number().int().min(0).max(65535).default(3300),
});
