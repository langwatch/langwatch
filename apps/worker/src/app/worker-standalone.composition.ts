import { createEventingRetentionConfiguration } from "@langwatch/eventing/server";
import { startWorkerMetricsServer } from "../platform/liveness/worker-metrics.server";
import { WorkerClickHouseInfrastructure } from "../platform/infrastructure/worker-clickhouse.infrastructure";
import { WorkerDatabaseInfrastructure } from "../platform/infrastructure/worker-database.infrastructure";
import {
  WorkerHandlePort,
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../platform/lifecycle/worker-runtime.port";
import { WorkerExecutableCompositionPort } from "../worker.executable";
import type { WorkerProcessComposition, WorkerProcessFactoryContext } from "../worker.process";
import { createWorkerPrivateInfrastructureComposition } from "./worker-private-infrastructure.composition";
import { createWorkerObjectStorage } from "./worker-object-storage.composition";
import {
  WorkerProductionComposition,
  type WorkerDatabaseCompositionOptions,
} from "./worker-production.composition";

/**
 * The standalone worker graph: the ONE consumer of `event-sourcing/jobs`.
 *
 * Everything this process runs on it opens for itself — one guarded Prisma
 * client, one routed ClickHouse connection, one Redis, one AWS client runtime
 * and one stored-object runtime — and each is owned by the boot scope, so
 * shutdown releases them in the reverse of the order they were taken.
 *
 * IT CLAIMS THE CONSUMER, and it is the only composition in this package that
 * may. `event-sourcing/jobs` is one queue holding every pipeline's jobs, and
 * the queue rejects an unroutable job for redelivery rather than dropping it —
 * so a graph that claimed it while any pipeline were unmounted would stall
 * that pipeline's work indefinitely with the pods up, the liveness probe
 * answering and the queue depth simply growing. `WorkerProductionComposition`
 * now mounts the complete registry, which is what makes this claim legal.
 *
 * There is no application graph anywhere below this line: no `getApp()`, no
 * platform singleton, and no second Eventing runtime in the process.
 */
export class WorkerStandaloneComposition extends WorkerExecutableCompositionPort {
  static create(): WorkerStandaloneComposition {
    return new WorkerStandaloneComposition();
  }

  private constructor() {
    super();
  }

  compose(context: WorkerProcessFactoryContext): WorkerProcessComposition {
    const { config, resources, observability } = context;

    const database = WorkerDatabaseInfrastructure.create({
      resources,
      database: config.infrastructure.database,
      nodeEnvironment: config.nodeEnvironment,
    });
    const prisma = database.connection.client as unknown as WorkerDatabaseCompositionOptions;

    const clickhouse = WorkerClickHouseInfrastructure.create({
      resources,
      clickhouse: config.infrastructure.clickhouse,
      // The routing directory: which organization a project belongs to. It is
      // read through the same client every other repository uses, so a project
      // that moves organizations is routed to its new endpoint on the next
      // resolution rather than on the next deploy.
      directory: {
        organizationForTenant: async (tenantId: string) => {
          const project = await database.connection.client.project.findUnique({
            where: { id: tenantId },
            select: { team: { select: { organizationId: true } } },
          });
          return project?.team?.organizationId ?? null;
        },
      },
    });

    // The BYOC lookup the Group Queue's blob offload and the stored-object
    // runtime both route through; composed once so both answer the same way.
    const objectStorage = createWorkerObjectStorage({ config, database: prisma, resources });

    const composition = WorkerProductionComposition.create({
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
      observability,
    });

    return {
      eventingConsumers: "packaged",
      application: composition.application,
    };
  }
}

/**
 * There is no application underneath this process to close.
 *
 * The port exists because the packaged executable used to run inside one; here
 * every client the graph opened is owned by the boot `ResourceScope`, which
 * `WorkerProcess` closes after the application has drained. A second closer
 * would release them while jobs were still finishing.
 */
class NoApplicationLifecycle extends WorkerLifecyclePort {
  async close(): Promise<void> {}
}

/**
 * The worker's one HTTP listener: the Prometheus metrics port, which also
 * answers the kubelet's unauthenticated `/healthz`.
 *
 * It is the TRANSPORT because it is the only thing this process listens on.
 * Everything else it does is driven by the queue.
 */
class WorkerMetricsTransport extends WorkerTransportPort {
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

  async start(): Promise<WorkerHandlePort> {
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

class WorkerMetricsHandle extends WorkerHandlePort {
  constructor(private readonly server: { close(): Promise<void> }) {
    super();
  }

  shutdown(): Promise<void> {
    return this.server.close();
  }
}
