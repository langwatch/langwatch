import {
  LangevalsClusteringError,
  type TopicClusteringOutcome,
  type TopicClusteringRequest,
} from "@langwatch/evaluation-contract";
import { createLogger } from "@langwatch/observability";
import { topicClusteringResponseSchema } from "@langwatch/topic-contract";

import type { LangevalsChannel } from "../channels/langevals.channel.ts";

const logger = createLogger("langwatch:evaluation:langevals-clustering");

const CLUSTERING_ROUTES = {
  batch: { path: "/topics/batch_clustering", kind: "topic_clustering_batch" },
  incremental: { path: "/topics/incremental_clustering", kind: "topic_clustering_incremental" },
} as const;

/** The first ten lines of a failure body, pretty-printed when it is JSON. */
function excerptOf(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2).split("\n").slice(0, 10).join("\n");
  } catch {
    return body;
  }
}

/** Topic clustering's langevals exchange: main's `fetchTopics*Clustering` post and read. */
export class LangevalsClusteringService {
  static create(input: {
    endpoint: string | undefined;
    langevals: LangevalsChannel;
  }): LangevalsClusteringService {
    return new LangevalsClusteringService(input.endpoint, input.langevals);
  }

  private constructor(
    private readonly endpoint: string | undefined,
    private readonly langevals: LangevalsChannel,
  ) {}

  async request(input: TopicClusteringRequest): Promise<TopicClusteringOutcome> {
    if (!this.endpoint) {
      logger.warn(
        { projectId: input.projectId },
        "Topic clustering service URL not set, skipping topic clustering",
      );
      return { kind: "not_configured" };
    }

    const route = CLUSTERING_ROUTES[input.mode];
    const response = await this.langevals.post({
      url: `${this.endpoint}${route.path}`,
      body: input.params,
      projectId: input.projectId,
      kind: route.kind,
      signal: input.signal,
    });

    if (!response.ok) {
      throw new LangevalsClusteringError({
        mode: input.mode,
        statusText: response.statusText,
        body: excerptOf(await response.text()),
      });
    }

    return {
      kind: "clustered",
      response: topicClusteringResponseSchema.parse(await response.json()),
    };
  }
}
