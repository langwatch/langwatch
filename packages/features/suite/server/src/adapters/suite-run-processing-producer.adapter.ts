/**
 * The `suite_run_processing` pipeline as a PRODUCER registers it.
 */
import type { FoldProjectionStore } from "@langwatch/eventing";
import type { SuiteRunStateData } from "@langwatch/suite-contract";
import { SuiteRunProcessingPipelineAdapter } from "./suite-run-processing.adapter";

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
 * Builds the suite-run-processing definition for a process that only sends commands on it.
 */
function buildSuiteRunProcessingProducerPipeline(input: { processName: string }) {
  return SuiteRunProcessingPipelineAdapter.create({
    suiteRunStateFoldStore: new ProducerOnlyFoldStore<SuiteRunStateData>(
      input.processName,
      "suite run state",
    ),
  });
}

/** The suite-run-processing definition as a command-only producer sees it. */
export class SuiteRunProcessingProducerAdapter {
  static create(options: { processName: string }): SuiteRunProcessingProducerAdapter {
    return new SuiteRunProcessingProducerAdapter(options);
  }

  private constructor(private readonly options: { processName: string }) {}

  build() {
    return buildSuiteRunProcessingProducerPipeline(this.options);
  }
}
