import { HandledError } from "@langwatch/handled-error";
import type {
  TopicApi,
  TopicClusteringTriggerResult,
  TopicProjectInput,
} from "@langwatch/topic-contract";

type TopicClusteringTriggerOptions = Readonly<{
  clustering: Pick<TopicApi, "getClusteringStatus" | "requestClustering">;
  reportFailure: (error: unknown, context: TopicProjectInput) => void;
  now: () => number;
}>;

/** A member's manual clustering request: refused while a run is in flight, else recorded. */
export class TopicClusteringTriggerService {
  readonly #options: TopicClusteringTriggerOptions;

  private constructor(options: TopicClusteringTriggerOptions) {
    this.#options = options;
  }

  static create(options: TopicClusteringTriggerOptions): TopicClusteringTriggerService {
    return new TopicClusteringTriggerService(options);
  }

  /**
   * A refusal the deployment already named is re-raised untouched; anything
   * else is event-store internals, so it stays an ordinary error the boundary
   * degrades to an unknown failure with a trace id.
   */
  async trigger({
    projectId,
    by,
  }: {
    projectId: string;
    by: Readonly<{ id: string }>;
  }): Promise<TopicClusteringTriggerResult> {
    try {
      return await this.#request({ projectId, by });
    } catch (error) {
      this.#options.reportFailure(error, { projectId });
      if (HandledError.isHandled(error)) throw error;
      throw new Error("Failed to trigger topic clustering", { cause: error });
    }
  }

  async #request({
    projectId,
    by,
  }: {
    projectId: string;
    by: Readonly<{ id: string }>;
  }): Promise<TopicClusteringTriggerResult> {
    const status = await this.#options.clustering.getClusteringStatus({ projectId });
    if (status.isRunInFlight) {
      return { started: false, reason: "already_running" };
    }

    await this.#options.clustering.requestClustering({
      projectId,
      occurredAt: this.#options.now(),
      trigger: "manual",
      requestedByUserId: by.id,
    });

    return { started: true };
  }
}
