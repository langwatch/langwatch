/**
 * One pipeline definition, two registrations: the worker mounts the process managers and drains every routing key; a producer takes only the four command dispatchers and no consumer loop. Passing none of the (optional) process managers is load-bearing — mounting either would drain the worker's queue rather than produce onto it — and a stand-in ledger refuses by name if ever called, rather than silently no-op'ing a fold that was never meant to happen.
 */
import { EventingGatewaySpendAdapter } from "./eventing.gateway-spend.adapter";
import { GatewaySpendEventsPort } from "../ports/gateway-spend-events.port";

/** Why every read and write below refuses, in the process's own words. */
function producerOnly(processName: string, capability: string): Error {
  return new Error(
    `${processName} registered the gateway_spend_processing pipeline as a producer only, so it cannot ${capability}. This work belongs to the worker that drains the pipeline.`,
  );
}

/**
 * The spend ledger a process that never folds holds. Every member refuses — a real read here means the graph wired the reconciliation door (which composes the REAL ledger) to the producer's stand-in instead, worth failing loudly.
 */
class ProducerOnlyGatewaySpendEvents extends GatewaySpendEventsPort {
  constructor(private readonly processName: string) {
    super();
  }

  upsertFromFold(): Promise<void> {
    return Promise.reject(producerOnly(this.processName, "write a spend row from the fold"));
  }

  tryReadForFold(): Promise<never> {
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

  readEndUserSpend(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "read one end user's spend"));
  }
}

/** The gateway-spend pipeline for a process that only sends commands. */
export class GatewaySpendProducerAdapter {
  static create(): GatewaySpendProducerAdapter {
    return new GatewaySpendProducerAdapter();
  }

  private constructor() {}

  /**
   * processName names the refusal, so a stand-in reached by accident says which process reached it rather than reporting an anonymous failure.
   */
  createGatewaySpendProducerPipeline(input: { processName: string }) {
    return EventingGatewaySpendAdapter.create({
      spendEvents: new ProducerOnlyGatewaySpendEvents(input.processName),
      // No process managers and no settlement sweeper: all three are the
      // worker's, and the sweeper's `connectSettlement` loop is the worker's
      // too. A producer that mounted them would drain the shared queue.
    }).buildProcessing();
  }
}
