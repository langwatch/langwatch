/**
 * The `gateway_spend_processing` pipeline as a PRODUCER registers it.
 *
 * One definition, two registrations. The consumer — the worker — supplies the
 * real ClickHouse spend ledger, mounts the webhook-delivery and gateway-debit
 * process managers and runs the settlement sweeper, and drains every routing
 * key the definition declares. A producer registers the SAME definition only
 * to obtain its four command dispatchers: `admitSpend`, `confirmSpend`,
 * `failSpend` and `settleSpend`, which is what the data plane's spooled batch
 * arrives as at `/api/internal/gateway/spend-commands`. It starts no consumer
 * loop, holds no event log and folds nothing.
 *
 * ## What a producer must be registered WITHOUT
 *
 * The three process managers are already optional on
 * {@link EventingGatewaySpendAdapter}, and this passes none of them. That is
 * the load-bearing half of the shape: the debit manager writes budgets and the
 * delivery manager ships a customer's webhooks, and a process that mounted
 * either would be draining the worker's queue rather than producing onto it.
 * The runtime's `processManagerMode: "producer-only"` would decline them by
 * name, but a definition that declares none cannot be registered wrongly by a
 * process that forgot to set the mode.
 *
 * The one dependency the definition still takes is the spend ledger, because
 * the fold projection is part of the definition rather than of a manager. A
 * producer folds nothing, so it supplies the stand-in below: it exists so the
 * definition can be CONSTRUCTED and refuses by name if it is ever CALLED.
 * Refusing rather than no-op'ing is the point — a silently-succeeding fold
 * store in a process that was never meant to fold would report a spend row as
 * written when nothing was, and the row would simply never be billed.
 *
 * Forking the definition instead — declaring only the four commands — is what
 * this avoids. The routing triple every job carries is derived from the
 * pipeline and command names, so two descriptions of one event stream drift
 * into jobs the worker cannot route, and the queue redelivers an unroutable
 * job forever rather than dropping it.
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
 * The spend ledger, as a process that never folds holds it.
 *
 * Every member refuses. The four reads are the reconciliation surface's, and
 * a process serving those composes the REAL ClickHouse ledger for them
 * (`api-gateway-spend-rest.composition.ts`) rather than reaching the pipeline's
 * copy — so a read arriving here is a graph that wired the reconciliation door
 * to the producer's stand-in, which is worth failing loudly.
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

/**
 * Builds the gateway-spend definition for a process that only sends commands
 * on it.
 *
 * `processName` names the refusal, so a stand-in reached by accident says which
 * process reached it rather than reporting an anonymous failure.
 */
export function createGatewaySpendProducerPipeline(input: { processName: string }) {
  return EventingGatewaySpendAdapter.create({
    spendEvents: new ProducerOnlyGatewaySpendEvents(input.processName),
    // No process managers and no settlement sweeper: all three are the
    // worker's, and the sweeper's `connectSettlement` loop is the worker's
    // too. A producer that mounted them would drain the shared queue.
  }).buildProcessing();
}
