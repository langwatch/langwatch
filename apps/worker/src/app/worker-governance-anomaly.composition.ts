import { AppGovernanceKpisAdapter } from "@langwatch/enterprise-api/governance/governance-kpis.adapter";
import { SsrfSafeAnomalyAlertHttpAdapter } from "@langwatch/enterprise-api/governance/ssrf-safe-anomaly-alert-http.adapter";
import {
  startSpendSpikeAnomalyWorker,
  type SpendSpikeAnomalyWorkerHandle,
} from "@langwatch/enterprise-worker";
import {
  fetchValidatedDestination,
  webhookUrlValidator,
  type EgressTlsPolicy,
  type SsrfValidationResult,
} from "@langwatch/egress";
import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import type { WorkerConfig } from "../platform/config/worker.config";

/**
 * The spend-spike anomaly evaluator, composed from this process's own
 * substrates.
 *
 * It is a SCHEDULER: a five-minute loop over the active `spend_spike`
 * AnomalyRules, not a queue consumer. It claims no routing key in the frozen
 * `job-registry.json`, which is why it rides the governance-events installer
 * rather than declaring one of its own — the arrangement the scheduled-report
 * calendar already has on Automation's installer, and for the same reason: a
 * second installer would have to own a pipeline, and this owns none.
 *
 * The platform started it the same way, from
 * `src/server/workers/startWorkers.ts`'s `bootSpendSpikeAnomalyWorker`, which
 * pushed the handle's `stop()` onto the process's shutdown list. What that root
 * did NOT do is give the dispatcher anywhere to send: it constructed the
 * evaluator over `prisma` alone, so every fired alert landed as
 * `detail.dispatch: "log_only"`. The three collaborators below are what turn
 * that into a delivered alert, and every one of them is something this process
 * already holds.
 *
 *     rules + alerts      the one Prisma client this process opened
 *     spend windows       the tenant-keyed ClickHouse client, through the same
 *                         `governance_kpis` adapter the trace roll-up writes
 *                         its contributions with
 *     delivery            the SSRF-safe HTTP adapter, over the strict address
 *                         policy every customer-supplied webhook destination in
 *                         this process is judged by
 */

/** The report-calendar-shaped lifecycle the governance-events installer drives. */
export interface WorkerGovernanceAnomalySchedule {
  start(): void;
  stop(): Promise<void>;
}

/**
 * The one outbound hop an anomaly alert takes, as a port.
 *
 * A port rather than a bare `fetch` for the same reason the ingestion pull's
 * egress is one: the address on the other end is a URL the CUSTOMER typed, and
 * the fence that judges it has to be observable from the outside. Composed with
 * a transport that answered every address, this graph would deliver a
 * customer's spend figures to `169.254.169.254` and record it as a success.
 */
export abstract class WorkerAnomalyAlertTransportPort {
  abstract send(destination: SsrfValidationResult, init: RequestInit): Promise<Response>;
}

/**
 * The production transport: the admitted destination, at the address it was
 * admitted at.
 *
 * Redirects are refused rather than followed. A hop is an address this
 * admission never judged, so following one would hand the whole policy back to
 * whoever answered first — which is what `followRedirects: false` means to the
 * fence, and what every customer-supplied destination passes.
 *
 * Certificate verification is the deployment's own answer, read from the same
 * leaf `createWorkerWebhookEgress` reads it from: an on-prem receiver commonly
 * carries a self-signed certificate while private addresses stay refused.
 */
export class FencedAnomalyAlertTransport extends WorkerAnomalyAlertTransportPort {
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
  database: object;
  /** The deployment's tenant-keyed ClickHouse client, for `governance_kpis`. */
  resolveClickHouseClient: EventingClickHouseClientResolver;
  /** How an admitted destination is reached. */
  transport: WorkerAnomalyAlertTransportPort;
}>;

/**
 * Builds the anomaly schedule without starting it.
 *
 * `start()` is the installer's to call, so the loop begins when the governance
 * graph is mounted rather than when the composition root builds it — a tick
 * that fired mid-composition would query a graph whose other half does not
 * exist yet.
 *
 * THE ADDRESS POLICY IS THE SHARED ONE, not a second copy. An anomaly
 * destination is a customer-supplied webhook URL fired from our workers, which
 * is exactly what `webhookUrlValidator` admits or refuses for the automations
 * channel and the endpoints platform. The escape hatch is not passed, on the
 * same grounds the automations channel never passes it: an alert we send on a
 * schedule must never reach `10.x` or `localhost`, whatever an operator relaxed
 * for their own integrations.
 */
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
): WorkerAnomalyAlertTransportPort {
  return FencedAnomalyAlertTransport.create({ rejectUnauthorized: config.deployment.saas });
}
