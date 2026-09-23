import { createLogger } from "@langwatch/observability";

import type { GatewayClickHouseClient } from "../../app/gateway.members.ts";
import { MAX_OPEN_ADMISSIONS_PER_SWEEP } from "../../rules/gateway-spend-settlement.rules.ts";
import {
  GatewayOpenAdmissionsRepository,
  type OpenAdmission,
  type OpenAdmissionQuery,
} from "../gateway-open-admissions.repository.ts";
import { ClickHouseGatewayOpenAdmissionsRepository } from "./clickhouse.gateway-open-admissions.repository.ts";

export { ClickHouseGatewayOpenAdmissionsRepository };

const logger = createLogger("langwatch:gateway-spend:settlement");

/** One entry per configured ClickHouse instance: the shared one and every private org. */
export interface GatewayClickHouseInstance {
  target: string;
  client: GatewayClickHouseClient;
}

export type GatewayClickHouseInstanceResolver = () => Promise<GatewayClickHouseInstance[]>;

/**
 * Settled per instance, never all-or-nothing: `Promise.all` would let one
 * unreachable private ClickHouse fail the whole sweep, burning the SHARED
 * instance's admissions too. Reachable instances settle; the rest retry next sweep.
 */
export class ClickHouseGatewayOpenAdmissionsAdapter extends GatewayOpenAdmissionsRepository {
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

    // The cap bounds ONE SWEEP; each instance already applies it to its own
    // query, so re-applying it here keeps the merged total, not N times it,
    // true to the documented bound. Sorting oldest-first before the cap sheds
    // the newest rows rather than whichever instance answered last, draining
    // the longest-waiting backlog first.
    open.sort((a, b) => a.admittedAtMs - b.admittedAtMs);
    return open.slice(0, MAX_OPEN_ADMISSIONS_PER_SWEEP);
  }
}
