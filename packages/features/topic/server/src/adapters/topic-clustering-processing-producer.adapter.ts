/**
 * The `topic_clustering_processing` pipeline as a PRODUCER registers it. One definition, two
 * registrations.
 */
import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
} from "@langwatch/eventing";
import {
  classifyClusteringError,
  type TopicClusteringDispatchDeps,
  type TopicClusteringMetricsPort,
  type TopicClusteringOutcomeCommands,
  type TopicClusteringPageOutcome,
  type TopicClusteringRunPort,
} from "../intents/topic-clustering.intent";
import {
  TopicClusteringEventingAdapter,
  type TopicClusteringRunHistoryData,
  type TopicClusteringRunStatusData,
  type TopicModelData,
} from "./eventing.topic-clustering.adapter";

/** Why every stand-in below refuses, in the process's own words. */
function producerOnly(processName: string, capability: string): Error {
  return new Error(
    `${processName} registered the topic_clustering_processing pipeline as a producer only, so it cannot ${capability}. This work belongs to the runner that drains the pipeline.`,
  );
}

/** An operational projection store that cannot load or write, because this process consumes nothing. */
class ProducerOnlyStateProjectionStore<TState> implements StateProjectionStore<TState> {
  constructor(
    private readonly processName: string,
    private readonly name: string,
  ) {}

  tryLoad(
    _key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjection<TState> | null> {
    return Promise.reject(producerOnly(this.processName, `read the ${this.name} projection`));
  }

  store(_projection: StoredProjection<TState>, _context: ProjectionStoreContext): Promise<void> {
    return Promise.reject(producerOnly(this.processName, `write the ${this.name} projection`));
  }
}

/**
 * The clustering executor the process manager's `run` intent would reach.
 */
class ProducerOnlyTopicClusteringRunPort implements TopicClusteringRunPort {
  constructor(private readonly processName: string) {}

  runClusteringPage(): Promise<TopicClusteringPageOutcome> {
    return Promise.reject(producerOnly(this.processName, "run a clustering page"));
  }
}

class ProducerOnlyTopicClusteringMetrics implements TopicClusteringMetricsPort {
  constructor(private readonly processName: string) {}

  incrementPageTotal(): void {
    throw producerOnly(this.processName, "record a clustering page metric");
  }

  observePageDuration(): void {
    throw producerOnly(this.processName, "record a clustering page duration");
  }
}

/**
 * The three outcome writes the process manager's own intent handler would
 * dispatch back into this SAME pipeline. Unreachable here for the same
 * reason as the run port: no process manager runs, so nothing ever calls these.
 */
class ProducerOnlyTopicClusteringOutcomeCommands implements TopicClusteringOutcomeCommands {
  constructor(private readonly processName: string) {}

  recordClusteringRunStarted(): Promise<void> {
    return this.refuse("record a clustering run start");
  }

  recordClusteringRunCompleted(): Promise<void> {
    return this.refuse("record a clustering run completion");
  }

  recordClusteringRunFailed(): Promise<void> {
    return this.refuse("record a clustering run failure");
  }

  private refuse(capability: string): Promise<never> {
    return Promise.reject(producerOnly(this.processName, capability));
  }
}

/** The topic-clustering-processing pipeline as a send-only process composes it. */
export class TopicClusteringProcessingProducerAdapter {
  static create(): TopicClusteringProcessingProducerAdapter {
    return new TopicClusteringProcessingProducerAdapter();
  }

  /**
   * Builds the topic-clustering-processing definition for a process that only sends commands on
   * it — `recordTopics` and `requestClustering`, the whole of `TopicClusteringCommandsPort`.
   */
  static createPipeline(input: { processName: string }) {
    const { processName } = input;
    const dispatch: TopicClusteringDispatchDeps = {
      runPort: new ProducerOnlyTopicClusteringRunPort(processName),
      commands: new ProducerOnlyTopicClusteringOutcomeCommands(processName),
      classifyError: classifyClusteringError,
      metrics: new ProducerOnlyTopicClusteringMetrics(processName),
    };

    return TopicClusteringEventingAdapter.createPipeline({
      topicClusteringRunStatusStore:
        new ProducerOnlyStateProjectionStore<TopicClusteringRunStatusData>(
          processName,
          "topic clustering run status",
        ),
      topicClusteringRunHistoryStore:
        new ProducerOnlyStateProjectionStore<TopicClusteringRunHistoryData>(
          processName,
          "topic clustering run history",
        ),
      topicModelStore: new ProducerOnlyStateProjectionStore<TopicModelData>(
        processName,
        "topic model",
      ),
      dispatch,
    });
  }
}
