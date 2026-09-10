import { createEventingRetentionConfiguration } from "@langwatch/eventing/server";
import { bindTenantDirectoryReader } from "@langwatch/organization-server";
import { startWorkerMetricsServer } from "../platform/liveness/worker-metrics.server.ts";
import { WorkerClickHouseInfrastructure } from "../platform/infrastructure/worker-clickhouse.infrastructure.ts";
import { WorkerDatabaseInfrastructure } from "../platform/infrastructure/worker-database.infrastructure.ts";
import {
  WorkerHandle,
  WorkerLifecycle,
  WorkerTransport,
} from "../platform/lifecycle/worker-runtime.port.ts";
import { WorkerExecutableComposition } from "../worker.executable.ts";
import type { WorkerProcessComposition, WorkerProcessFactoryContext } from "../worker.process.ts";
import { createWorkerPrivateInfrastructureComposition } from "./worker-private-infrastructure.composition.ts";
import { createWorkerObjectStorage } from "./worker-object-storage.composition.ts";
import {
  WorkerProductionComposition,
  type WorkerDatabaseCompositionOptions,
} from "./worker-production.composition.ts";

/**
 * The standalone worker graph: the ONE consumer of `event-sourcing/jobs`.
 */
export class WorkerStandaloneComposition extends WorkerExecutableComposition {
  static create(): WorkerStandaloneComposition {
    return new WorkerStandaloneComposition();
  }

  private constructor() {
    super();
  }

  async compose(context: WorkerProcessFactoryContext): Promise<WorkerProcessComposition> {
    const { config, resources, observability } = context;

    const database = WorkerDatabaseInfrastructure.create({
      resources,
      database: config.infrastructure.database,
      nodeEnvironment: config.nodeEnvironment,
      logger: observability.logger,
    });
    const prisma = database.connection.client as unknown as WorkerDatabaseCompositionOptions;

    const clickhouse = WorkerClickHouseInfrastructure.create({
      resources,
      clickhouse: config.infrastructure.clickhouse,
      // The routing directory, over the three kinds of tenant the event store
      // carries: a project names its owner, an organization names itself, and
      // a user is platform-level, so no membership is consulted. The SAME
      // implementation the API process composes, read through the same client
      // every repository uses, so a project that moves organizations routes to
      // its new endpoint on the next resolution.
      directory: bindTenantDirectoryReader(database.connection.client),
    });

    // The BYOC lookup the Group Queue's blob offload and the stored-object
    // runtime both route through; composed once so both answer the same way.
    const objectStorage = createWorkerObjectStorage({ config, database: prisma, resources });

    const composition = await WorkerProductionComposition.create({
      config,
      resources,
      lifecycle: new NoApplicationLifecycle(),
      transport: WorkerMetricsTransport.create({ config, observability }),
      infrastructure: createWorkerPrivateInfrastructureComposition({
        config,
        ports: { projects: objectStorage.projects },
      }),
      eventing: {
        database: database.connection.client as never,
        resolveClickHouseClient: clickhouse.resolveClient as never,
        // The other half of the same connection: the tenant-keyed resolver
        // above for everything a tenant does, and the instance directory for
        // the one sweep that is nobody's tenant — settling admissions whose
        // confirmation never arrived, on every configured endpoint at once.
        resolveClickHouseInstances: clickhouse.resolveInstances,
        // The third question the same connection answers: one organization's
        // endpoint, for the anonymous usage report that already holds the
        // organization and would otherwise route through a project id to get
        // back to it.
        resolveClickHouseOrganizationClient: clickhouse.resolveOrganizationClient,
        retention: createEventingRetentionConfiguration({
          defaultRetentionDays: config.retention.defaultDays,
        }),
        consumers: { enabled: true },
      },
      database: prisma,
      // The SAME client, un-narrowed: the tenancy graph's two adapters declare
      // the generated `PrismaClient` by type, so it crosses whole rather than
      // through the structural intersection above.
      connection: database.connection,
      featureClickHouse: clickhouse,
      observability,
    });

    return {
      eventingConsumers: "packaged",
      application: composition.application,
    };
  }
}

/**
 * There is no application underneath this process to close. The port exists because the packaged
 * executable used to run inside one; here every client the graph opened is owned by the boot
 * `ResourceScope`, which `WorkerProcess` closes after the application has drained.
 */
class NoApplicationLifecycle extends WorkerLifecycle {
  async close(): Promise<void> {}
}

/**
 * The worker's one HTTP listener: the Prometheus metrics port, which also answers the kubelet's
 * unauthenticated `/healthz`. It is the TRANSPORT because it is the only thing this process listens
 * on. Everything else it does is driven by the queue.
 */
class WorkerMetricsTransport extends WorkerTransport {
  static create(options: {
    config: WorkerProcessFactoryContext["config"];
    observability: WorkerProcessFactoryContext["observability"];
  }): WorkerMetricsTransport {
    return new WorkerMetricsTransport(options);
  }

  private constructor(
    private readonly options: {
      config: WorkerProcessFactoryContext["config"];
      observability: WorkerProcessFactoryContext["observability"];
    },
  ) {
    super();
  }

  async start(): Promise<WorkerHandle> {
    const server = await startWorkerMetricsServer({
      port: this.options.config.liveness.metricsPort,
      // The bearer gate the App applies to its own `/metrics`. Unset means the
      // endpoint answers unauthenticated, which is the reading a cluster-local
      // scrape target has always had.
      isAuthorized: (request) =>
        !this.options.config.liveness.metricsToken ||
        request.headers.authorization === `Bearer ${this.options.config.liveness.metricsToken}`,
      // No prom-client registry in this process: every metric it records goes
      // out over OTLP. The endpoint stays so the kubelet's probe has something
      // to answer, and it reports an empty exposition rather than pretending.
      readMetrics: async () => ({ body: "", contentType: "text/plain; version=0.0.4" }),
      logger: this.options.observability.logger,
    });
    return new WorkerMetricsHandle(server);
  }
}

class WorkerMetricsHandle extends WorkerHandle {
  constructor(private readonly server: { close(): Promise<void> }) {
    super();
  }

  shutdown(): Promise<void> {
    return this.server.close();
  }
}
