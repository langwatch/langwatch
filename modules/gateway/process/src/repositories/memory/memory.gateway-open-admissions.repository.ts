import { MAX_OPEN_ADMISSIONS_PER_SWEEP } from "../../rules/gateway-spend-settlement.rules.ts";
import {
  GatewayOpenAdmissionsRepository,
  type OpenAdmission,
  type OpenAdmissionQuery,
} from "../gateway-open-admissions.repository.ts";
import type { MemoryGatewaySpendEventsRepository } from "./memory.gateway-spend-events.repository.ts";

/** Requests still admitted past their grace, read off the memory spend record, oldest first. */
export class MemoryGatewayOpenAdmissionsRepository extends GatewayOpenAdmissionsRepository {
  static create(
    spendEvents: MemoryGatewaySpendEventsRepository,
  ): MemoryGatewayOpenAdmissionsRepository {
    return new MemoryGatewayOpenAdmissionsRepository(spendEvents);
  }

  private constructor(private readonly spendEvents: MemoryGatewaySpendEventsRepository) {
    super();
  }

  async findOpenAdmissions(query: OpenAdmissionQuery): Promise<OpenAdmission[]> {
    const openBeforeMs = query.now - query.graceMs;
    const fromMs = query.now - query.lookbackMs;

    return this.spendEvents
      .latestRows()
      .filter((row) => {
        const at = row.occurredAt.epochMilliseconds;
        return row.status === "admitted" && at >= fromMs && at < openBeforeMs;
      })
      .toSorted(
        (left, right) => left.occurredAt.epochMilliseconds - right.occurredAt.epochMilliseconds,
      )
      .slice(0, MAX_OPEN_ADMISSIONS_PER_SWEEP)
      .map((row) => ({
        tenantId: row.tenantId,
        gatewayRequestId: row.gatewayRequestId,
        organizationId: row.organizationId,
        virtualKeyId: row.virtualKeyId,
        principalUserId: row.principalUserId,
        endUserId: row.endUserId,
        traceId: row.traceId,
        requestType: row.requestType,
        labels: row.labels,
        metadata: row.metadata,
        admittedAtMs: row.occurredAt.epochMilliseconds,
        model: row.model,
        providerKey: row.providerKey,
      }));
  }
}
