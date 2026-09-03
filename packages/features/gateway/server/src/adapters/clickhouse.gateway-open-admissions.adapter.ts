import { createLogger } from "@langwatch/observability";
import type { GatewayClickHouseClient } from "../ports/gateway-clickhouse.port";
import {
  GatewayOpenAdmissionsPort,
  type OpenAdmission,
  type OpenAdmissionQuery,
} from "../ports/gateway-open-admissions.port";
import { ClickHouseGatewayOpenAdmissionsRepository } from "../repositories/clickhouse/clickhouse.gateway-open-admissions.repository";
import { MAX_OPEN_ADMISSIONS_PER_SWEEP } from "../intents/gateway-spend-settlement.intent";

export { ClickHouseGatewayOpenAdmissionsRepository };

const logger = createLogger("langwatch:gateway-spend:settlement");

/** One entry per configured ClickHouse instance: the shared one and every private org. */
export interface GatewayClickHouseInstance {
  target: string;
  client: GatewayClickHouseClient;
}

export type GatewayClickHouseInstanceResolver = () => Promise<GatewayClickHouseInstance[]>;

/**
 * The settlement sweeper's read side across EVERY configured ClickHouse
 * instance, shared and private alike: one sweeper settles the whole install,
 * so it cannot hold a single client.
 *
 * Settled per instance, never all-or-nothing. `Promise.all` is fail-fast, so
 * one unreachable private ClickHouse would reject the whole read, fail the
 * sweep intent, burn its attempts and keep failing every wake while that
 * instance was down — taking the SHARED instance's open admissions with it.
 * That contradicts the rule the sweep already states for a single tenant's
 * failure, so it applies at the instance level too: the reachable instances
 * settle, the unreachable one is reported and retried next sweep.
 */
export class ClickHouseGatewayOpenAdmissionsAdapter extends GatewayOpenAdmissionsPort {
  static create(
    resolveInstances: GatewayClickHouseInstanceResolver,
  ): ClickHouseGatewayOpenAdmissionsAdapter {
    return new ClickHouseGatewayOpenAdmissionsAdapter(resolveInstances);
  }

  private constructor(private readonly resolveInstances: GatewayClickHouseInstanceResolver) {
    super();
  }

  async findOpenAdmissions(params: OpenAdmissionQuery): Promise<OpenAdmission[]> {
    const instances = await this.resolveInstances();
    const results = await Promise.allSettled(
      instances.map(({ client }) =>
        ClickHouseGatewayOpenAdmissionsRepository.create(client).findOpenAdmissions(params),
      ),
    );

    const open: OpenAdmission[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        open.push(...result.value);
        return;
      }
      logger.warn(
        {
          target: instances[index]?.target,
          error: result.reason,
        },
        "settlement sweep could not read one ClickHouse instance; its open admissions wait for the next sweep",
      );
    });

    // The cap bounds ONE SWEEP, and each instance applies it to its own
    // query — so N instances would hand the sweeper N times the cap.
    // Re-applying it here is what makes the documented bound true of
    // the number the sweeper actually settles.
    //
    // Oldest first, across instances, so the cap sheds the newest rows
    // rather than whichever instance happened to answer last. Each
    // query already returns its own rows oldest-first; this is what
    // extends that ordering to the merge, and it keeps the sweep
    // draining a backlog from the end that has waited longest.
    open.sort((a, b) => a.admittedAtMs - b.admittedAtMs);
    return open.slice(0, MAX_OPEN_ADMISSIONS_PER_SWEEP);
  }
}
