import {
  WorkerExecutableCompositionPort,
  WorkerProductionComposition,
  type WorkerApplicationPort,
  type WorkerProcessComposition,
  type WorkerProcessFactoryContext,
} from "@langwatch/worker";
import { AppBoot } from "~/runtime/app/boot";
import { AppBootConfigService, fixedAppBootConfigResolver } from "~/runtime/config";
import { initializeWorkerApp } from "~/server/app-layer/presets";
import { isClickHouseEnabled } from "~/server/clickhouse/clickhouseClient";
import { createLegacyWorkerPorts } from "./legacy-worker.adapter";
import {
  packagedWorkerCapabilities,
  packagedWorkerEventing,
  requirePackagedWorkerConsumer,
} from "./packaged-worker.capabilities";

/**
 * The packaged worker graph as the one consumer of `event-sourcing/jobs`.
 *
 * Two Eventing runtimes exist in this process. The App builds the first and is
 * asked for `eventingConsumers: "external"`, which leaves it byte-for-byte the
 * web-role App that has produced without consuming for months; the composition
 * below builds the second from the App's own substrate and is the only one that
 * claims the queue. Ownership is a parameter of the single booted composition,
 * so a process can neither hold two consumers nor silently hold none — the
 * refusals in `requirePackagedWorkerConsumer` turn every way of ending up
 * producer-only into a boot failure.
 *
 * The App still owns the process: `startWorkers()` runs every non-Eventing loop
 * through the same ports the legacy composition used, and closing the App is
 * still the last thing that happens.
 */
export class PackagedWorkerExecutableComposition extends WorkerExecutableCompositionPort {
  static create(options: {
    source: Readonly<Record<string, unknown>>;
  }): PackagedWorkerExecutableComposition {
    return new PackagedWorkerExecutableComposition(options.source);
  }

  async compose(context: WorkerProcessFactoryContext): Promise<WorkerProcessComposition> {
    const appConfig = new AppBootConfigService().resolve(this.source);
    let application: WorkerApplicationPort | undefined;
    const appBoot = new AppBoot({
      config: fixedAppBootConfigResolver(appConfig),
      compose: async (_config, resources) => {
        const app = initializeWorkerApp({ eventingConsumers: "external" });
        const handoff = requirePackagedWorkerConsumer({
          handoff: app.workerEventingHandoff,
          clickHouseEnabled: isClickHouseEnabled(),
        });
        const ports = createLegacyWorkerPorts(app);
        // The SaaS meter's sender comes from the graph these options compose,
        // so the closure reads it back through this holder rather than closing
        // over a handle that does not exist yet.
        const packaged: { composition?: WorkerProductionComposition } = {};
        const composition = WorkerProductionComposition.create({
          config: context.config,
          eventing: packagedWorkerEventing(handoff),
          lifecycle: ports.lifecycle,
          transport: ports.transport,
          resources,
          observability: context.observability,
          ...packagedWorkerCapabilities({
            handoff,
            billingUsageDispatch: () => billingUsageSender(packaged.composition),
          }),
        });
        packaged.composition = composition;
        application = composition.application;
        return {
          // Composing is all that happens here. Installing 26 pipelines is what
          // starts consuming, and the process root owns when that begins so a
          // failure arrives through the lifecycle that can drain it.
          start: () => void 0,
          close: () => composition.application.close(),
        };
      },
    });
    const booted = await appBoot.boot({});
    if (!application) {
      throw new Error("Packaged worker composition produced no application.");
    }
    return {
      application: PackagedBootedWorkerApplication.create({
        application,
        releaseBoot: booted.close,
      }),
    };
  }

  private constructor(private readonly source: Readonly<Record<string, unknown>>) {
    super();
  }
}

/**
 * The SaaS meter's sender, taken from the graph these very options composed.
 *
 * The billable-events meter is configured on the Eventing runtime before any
 * pipeline exists, so it cannot close over a handle to the billing pipeline —
 * it closes over this, called when a billable event is dispatched, and the
 * installer's proxy refuses until the pipeline it names is registered.
 */
function billingUsageSender(composition: WorkerProductionComposition | undefined) {
  const commands = composition?.billingReporting?.commands;
  if (!commands) {
    throw new Error(
      "Packaged worker billing reporting is not composed; the billable-events meter has no sender.",
    );
  }
  return commands.reportUsageForMonth;
}

/**
 * The packaged application, with the App's boot scope released after it drains.
 *
 * The order is the whole point of the wrapper. `drain()` stops the consumer and
 * closes the feature handles while Prisma, ClickHouse and Redis are still live,
 * and only `closeResources()` releases the scope that closes the App underneath
 * it. Reversing them would pull the substrate out from under jobs that are
 * still finishing.
 */
class PackagedBootedWorkerApplication implements WorkerApplicationPort {
  static create(options: {
    application: WorkerApplicationPort;
    releaseBoot: () => Promise<void>;
  }): PackagedBootedWorkerApplication {
    return new PackagedBootedWorkerApplication(options.application, options.releaseBoot);
  }

  private releasing: Promise<void> | undefined;
  private closing: Promise<void> | undefined;

  private constructor(
    private readonly application: WorkerApplicationPort,
    private readonly releaseBoot: () => Promise<void>,
  ) {}

  start(): Promise<void> {
    return this.application.start();
  }

  drain(): Promise<void> {
    return this.application.drain();
  }

  closeResources(): Promise<void> {
    this.releasing ??= this.releaseBoot();
    return this.releasing;
  }

  close(): Promise<void> {
    this.closing ??= this.closeApplication();
    return this.closing;
  }

  private async closeApplication(): Promise<void> {
    let firstError: unknown;
    try {
      await this.drain();
    } catch (error) {
      firstError = error;
    }
    try {
      await this.closeResources();
    } catch (error) {
      firstError ??= error;
    }
    if (firstError) throw firstError;
  }
}
