import { collectDefaultMetrics, register } from "prom-client";
import type { ApiMetricsPort } from "../../api-process.lifecycle";
import {
  PrometheusApiMetricsAdapter,
  type ApiMetricsAccess,
} from "./prometheus.api-metrics.adapter";

/**
 * The default collector whose presence says this process already installed the
 * rest of them. A registry refuses a collector it already holds, so this check
 * is what lets one process compose the surface twice.
 */
const DEFAULT_METRIC_PROBE = "process_cpu_user_seconds_total";

export type ApiMetricsInfrastructureOptions = {
  /** The bearer credential this process was configured with, if it was given one. */
  key: string | undefined;
  /** Decides whether an unconfigured key is a development convenience or a misconfiguration. */
  nodeEnvironment: string;
};

/** Reports the composition decision an unconfigured key would otherwise hide. */
export abstract class ApiMetricsAbsenceReportPort {
  abstract absent(): void;
}

/**
 * API-owned construction of the process's Prometheus scrape surface.
 *
 * The registry is `prom-client`'s process-global one, deliberately. The port
 * this composes for asks the API never to import a PLATFORM registry, and it
 * does not — but the samples this process actually produces come from
 * `@langwatch/group-queue` and `@langwatch/eventing`, which register into the
 * global. A fresh registry here would serve a scrape that parses, returns 200,
 * and holds none of this process's dispatch work: the silent, total loss
 * `apps/worker`'s metrics server carries the same warning about.
 *
 * What IS this process's own is who may read that registry, and that is the
 * decision this class makes.
 */
export class ApiMetricsInfrastructure {
  /**
   * Composes the scrape surface only when this deployment can serve it safely.
   *
   * Three outcomes, and the middle one is the point:
   *
   *  - A configured key: the endpoint exists, gated by that key.
   *  - No key in production: NO endpoint, and the caller is told. An unset
   *    credential is a misconfiguration rather than an invitation, and a route
   *    that answered every scrape with a refusal would be a surface that
   *    exists only to say no.
   *  - No key outside production: the endpoint is open, which is the
   *    convenience the web process has always allowed. Keeping the two
   *    identical is what lets an operator hold one rule about this variable
   *    rather than one per tier.
   */
  static tryCreate(
    options: ApiMetricsInfrastructureOptions & { report?: ApiMetricsAbsenceReportPort },
  ): ApiMetricsInfrastructure | undefined {
    const key = options.key?.trim();
    if (key) {
      return ApiMetricsInfrastructure.create({ access: { gate: "bearer", key } });
    }
    if (options.nodeEnvironment === "production") {
      options.report?.absent();
      return undefined;
    }
    return ApiMetricsInfrastructure.create({ access: { gate: "open" } });
  }

  static create(options: { access: ApiMetricsAccess }): ApiMetricsInfrastructure {
    if (!register.getSingleMetric(DEFAULT_METRIC_PROBE)) {
      collectDefaultMetrics({ register });
    }
    return new ApiMetricsInfrastructure(
      PrometheusApiMetricsAdapter.create({ registry: register, access: options.access }),
    );
  }

  private constructor(readonly metrics: ApiMetricsPort) {}
}
