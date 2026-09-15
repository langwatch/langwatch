import type {
  PlatformHealthCheck,
  PlatformHealthCheckName,
  PlatformHealthQuery,
  PlatformHealthReport,
} from "@langwatch/platform-health-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { SubsystemProbe } from "../app/platform-health.members.ts";
import { rollUpStatus } from "../rules/platform-health-report.rules.ts";

const logger = createLogger("langwatch:platform-health");

/**
 * Runs the probes and reports what they said. Every probe is isolated: a
 * monitor that loses the whole answer to one broken subsystem cannot tell a
 * broken platform from a broken health check.
 */
export class PlatformHealthService {
  readonly #probes: readonly SubsystemProbe[];

  private constructor(probes: readonly SubsystemProbe[]) {
    this.#probes = probes;
  }

  static create(options: { probes: readonly SubsystemProbe[] }): PlatformHealthService {
    return new PlatformHealthService(options.probes);
  }

  async checkAll(query: PlatformHealthQuery): Promise<PlatformHealthReport> {
    return this.#report(await Promise.all(this.#probes.map((probe) => this.#run(probe, query))));
  }

  async checkOne(
    name: PlatformHealthCheckName,
    query: PlatformHealthQuery,
  ): Promise<PlatformHealthReport> {
    const probe = this.#probes.find((candidate) => candidate.name === name);
    if (!probe) return this.#report([]);
    return this.#report([await this.#run(probe, query)]);
  }

  #report(checks: readonly PlatformHealthCheck[]): PlatformHealthReport {
    return {
      status: rollUpStatus(checks),
      checkedAt: nowInstant().toString(),
      checks: [...checks],
    };
  }

  async #run(probe: SubsystemProbe, query: PlatformHealthQuery): Promise<PlatformHealthCheck> {
    const startedAt = nowInstant().epochMilliseconds;
    try {
      const result = await probe.run(query);
      return {
        name: probe.name,
        status: result.outcome,
        durationMs: nowInstant().epochMilliseconds - startedAt,
        ...(result.outcome === "healthy" ? {} : { detail: result.detail }),
      };
    } catch (error) {
      // The thrown detail is ours to keep: the answer goes to whoever holds
      // the monitoring key, and an upstream's own prose is a log line.
      logger.error({ probe: probe.name, error }, "Platform health probe threw");
      return {
        name: probe.name,
        status: "unhealthy",
        durationMs: nowInstant().epochMilliseconds - startedAt,
        detail: "the probe could not complete",
      };
    }
  }
}
