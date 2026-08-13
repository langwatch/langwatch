import type { GatewaySpendEventsRepository } from "./spendEvents.clickhouse.repository";

/**
 * Read side of the gateway spend ledger, behind the repository the App
 * hands out. The reconciliation pull surface (REST) and its ledger-screen
 * tRPC counterpart both read through this service rather than the
 * repository directly — routes and routers reach ClickHouse only via a
 * service, per the access boundary (ADR-072 names the two as one
 * enterprise capability read from the same store).
 */
export class GatewaySpendEventsService {
  constructor(private readonly repository: GatewaySpendEventsRepository) {}

  getSpendEventsPage(
    params: Parameters<GatewaySpendEventsRepository["readSpendEventsPage"]>[0],
  ): ReturnType<GatewaySpendEventsRepository["readSpendEventsPage"]> {
    return this.repository.readSpendEventsPage(params);
  }

  getSpendSummaries(
    params: Parameters<GatewaySpendEventsRepository["readSpendSummaries"]>[0],
  ): ReturnType<GatewaySpendEventsRepository["readSpendSummaries"]> {
    return this.repository.readSpendSummaries(params);
  }

  walkSpendEvents(
    params: Parameters<GatewaySpendEventsRepository["walkSpendEvents"]>[0],
  ): ReturnType<GatewaySpendEventsRepository["walkSpendEvents"]> {
    return this.repository.walkSpendEvents(params);
  }

  getEndUserSpend(
    params: Parameters<GatewaySpendEventsRepository["readEndUserSpend"]>[0],
  ): ReturnType<GatewaySpendEventsRepository["readEndUserSpend"]> {
    return this.repository.readEndUserSpend(params);
  }
}
