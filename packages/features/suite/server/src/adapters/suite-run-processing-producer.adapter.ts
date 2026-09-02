/**
 * The `suite_run_processing` pipeline as a PRODUCER registers it.
 *
 * One definition, two registrations. The consumer — the worker — supplies the
 * real run-state fold and drains every routing key the definition declares. A
 * producer registers the SAME definition only to obtain its command
 * dispatchers: `startSuiteRun` off a tRPC call, and nothing else. It starts no
 * consumer loop, holds no event log and folds nothing.
 *
 * The one dependency the definition takes is consumer-side, and a producer does
 * not have it. That is what this module supplies — a stand-in that exists so
 * the definition can be CONSTRUCTED and refuses by name if it is ever CALLED.
 * Refusing rather than no-op'ing is the whole point: a silently-succeeding fold
 * store in a process that was never meant to fold would report a suite run's
 * progress as written when nothing was, and the row would simply never appear.
 *
 * THE DEDUPLICATION IS PART OF THE DEFINITION, not of the registration. Each of
 * the three commands folds by ADDITION, so a redelivered one double-counts a
 * run's progress; the definition registers all three with their `makeJobId`
 * windows, and a producer registering that same definition sends jobs the
 * consumer deduplicates on exactly those keys. Forking the definition here —
 * declaring only the one command a producer sends — would drop the window along
 * with the routing triple the worker's registry claims.
 */
import type { FoldProjectionStore } from "@langwatch/eventing";
import type { SuiteRunStateData } from "@langwatch/suite-contract";
import { createSuiteRunProcessingPipeline } from "./suite-run-processing.adapter";

/** Why the stand-in below refuses, in the process's own words. */
function producerOnly(processName: string, capability: string): Error {
  return new Error(
    `${processName} registered the suite_run_processing pipeline as a producer only, so it cannot ${capability}. This work belongs to the worker that drains the pipeline.`,
  );
}

/** A fold store that cannot fold, because this process consumes nothing. */
class ProducerOnlyFoldStore<TState> implements FoldProjectionStore<TState> {
  constructor(
    private readonly processName: string,
    private readonly name: string,
  ) {}

  store(): Promise<void> {
    return Promise.reject(producerOnly(this.processName, `write the ${this.name} projection`));
  }

  get(): Promise<TState | null> {
    return Promise.reject(producerOnly(this.processName, `read the ${this.name} projection`));
  }
}

/**
 * Builds the suite-run-processing definition for a process that only sends
 * commands on it.
 *
 * `processName` names the refusal, so a stand-in reached by accident says which
 * process reached it rather than reporting an anonymous failure.
 */
export function createSuiteRunProcessingProducerPipeline(input: { processName: string }) {
  return createSuiteRunProcessingPipeline({
    suiteRunStateFoldStore: new ProducerOnlyFoldStore<SuiteRunStateData>(
      input.processName,
      "suite run state",
    ),
  });
}
