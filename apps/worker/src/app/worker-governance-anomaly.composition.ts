import { AppGovernanceKpisAdapter } from "@langwatch/enterprise-api/governance/governance-kpis.adapter";
import { SsrfSafeAnomalyAlertHttpAdapter } from "@langwatch/enterprise-api/governance/ssrf-safe-anomaly-alert-http.adapter";
import {
  startSpendSpikeAnomalyWorker,
  type SpendSpikeAnomalyWorkerDependencies,
  type SpendSpikeAnomalyWorkerHandle,
} from "@langwatch/enterprise-worker";
import {
  fetchValidatedDestination,
  webhookUrlValidator,
  type EgressTlsPolicy,
  type SsrfValidationResult,
} from "@langwatch/egress";
import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import type { WorkerConfig } from "../platform/config/worker.config.ts";

// Spend-spike anomaly evaluator; a five-minute scheduler that fires alerts
// through Prisma, ClickHouse and the SSRF-safe HTTP adapter this process holds

/** The report-calendar-shaped lifecycle the governance-events installer drives. */
export interface WorkerGovernanceAnomalySchedule {
  start(): void;
  stop(): Promise<void>;
}

// Outbound hop for anomaly alerts; a port so the address fence is observable
// from the outside
export abstract class WorkerAnomalyAlertTransport {
  abstract send(destination: SsrfValidationResult, init: RequestInit): Promise<Response>;
}

// Production transport: refused redirects and per-deployment certificate
// verification policy
export class FencedAnomalyAlertTransport extends WorkerAnomalyAlertTransport {
  static create(tls: EgressTlsPolicy): FencedAnomalyAlertTransport {
    return new FencedAnomalyAlertTransport(tls);
  }

  private constructor(private readonly tls: EgressTlsPolicy) {
    super();
  }

  async send(destination: SsrfValidationResult, init: RequestInit): Promise<Response> {
    const response = await fetchValidatedDestination(
      destination,
      { ...init, followRedirects: false },
      this.tls,
    );
    return response as unknown as Response;
  }
}

export type WorkerGovernanceAnomalyOptions = Readonly<{
  /** The one Prisma client this process opened: AnomalyRule and AnomalyAlert. */
  database: SpendSpikeAnomalyWorkerDependencies["database"];
  /** The deployment's tenant-keyed ClickHouse client, for `governance_kpis`. */
  resolveClickHouseClient: EventingClickHouseClientResolver;
  /** How an admitted destination is reached. */
  transport: WorkerAnomalyAlertTransport;
}>;

// Builds the anomaly schedule without starting it; `start()` is called by
// the installer so the loop begins when governance graph mounts
export function createWorkerGovernanceAnomalySchedule(
  options: WorkerGovernanceAnomalyOptions,
): WorkerGovernanceAnomalySchedule {
  const validate = webhookUrlValidator(false);
  const http = SsrfSafeAnomalyAlertHttpAdapter.create(async (url, init) => {
    const destination = await validate(url);
    return options.transport.send(destination, init);
  });
  const spend = new AppGovernanceKpisAdapter(
    options.resolveClickHouseClient as unknown as ConstructorParameters<
      typeof AppGovernanceKpisAdapter
    >[0],
  );

  let handle: SpendSpikeAnomalyWorkerHandle | undefined;

  return {
    start() {
      handle ??= startSpendSpikeAnomalyWorker({
        database: options.database,
        spend,
        http,
      });
    },
    async stop() {
      handle?.stop();
      handle = void 0;
    },
  };
}

/** The transport a deployment sends anomaly alerts through, TLS answer included. */
export function createWorkerAnomalyAlertTransport(
  config: WorkerConfig,
): WorkerAnomalyAlertTransport {
  return FencedAnomalyAlertTransport.create({ rejectUnauthorized: config.deployment.saas });
}
