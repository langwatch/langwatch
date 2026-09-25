import { GatewaySpendEventsRepository } from "../repositories/gateway-spend-events.repository.ts";
/**
 * One pipeline definition, two registrations. A producer takes only the command
 * dispatchers — passing no process managers here is load-bearing: mounting any
 * would drain the worker's shared queue instead of producing onto it.
 */
import { EventingGatewaySpendAdapter } from "./gateway-spend.adapter.ts";

/** Why every read and write below refuses, in the process's own words. */
function producerOnly(processName: string, capability: string): Error {
  return new Error(
    `${processName} registered the gateway_spend_processing pipeline as a producer only, so it cannot ${capability}. This work belongs to the worker that drains the pipeline.`,
  );
}

/**
 * The spend ledger a process that never folds holds. Every member refuses —
 * a real read here means the graph wired the reconciliation door to this
 * stand-in instead of the real ledger, worth failing loudly.
 */
class ProducerOnlyGatewaySpendEvents extends GatewaySpendEventsRepository {
  constructor(private readonly processName: string) {
    super();
  }

  upsertFromFold(): Promise<void> {
    return Promise.reject(producerOnly(this.processName, "write a spend row from the fold"));
  }

  findForFold(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "read a spend row for the fold"));
  }

  readSpendEventsPage(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "page the spend ledger"));
  }

  walkSpendEvents(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "walk the spend ledger"));
  }

  readSpendSummaries(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "summarise the spend ledger"));
  }

  sumCostNanoUsdByRequestType(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "sum the spend ledger by request type"));
  }

  readEndUserSpend(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "read one end user's spend"));
  }

  countUsage(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "count the spend ledger"));
  }
}

/** The gateway-spend pipeline for a process that only sends commands. */
export class GatewaySpendProducerAdapter {
  static create(): GatewaySpendProducerAdapter {
    return new GatewaySpendProducerAdapter();
  }

  private constructor() {}

  /**
   * processName names the refusal, so a stand-in reached by accident says
   * which process reached it, not an anonymous failure.
   */
  createGatewaySpendProducerPipeline(input: {
    processName: string;
  }): ReturnType<EventingGatewaySpendAdapter["buildProcessing"]> {
    return EventingGatewaySpendAdapter.create({
      spendEvents: new ProducerOnlyGatewaySpendEvents(input.processName),
      // No process managers and no settlement sweeper: all three are the
      // worker's, and the sweeper's `connectSettlement` loop is the worker's
      // too. A producer that mounted them would drain the shared queue.
    }).buildProcessing();
  }
}
