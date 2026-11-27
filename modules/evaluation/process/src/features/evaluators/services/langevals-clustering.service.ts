import {
  LANGEVALS_CLUSTERING_FAILURE_CODES,
  LangevalsClusteringError,
  type LangevalsClusteringFailureCode,
  type TopicClusteringOutcome,
  type TopicClusteringRequest,
} from "@langwatch/evaluation-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { topicClusteringResponseSchema } from "@langwatch/topic-contract";

import type {
  LangevalsChannel,
  LangevalsPayloadStaging,
} from "../../../channels/langevals.channel.ts";
import type { LangevalsProviderSpendService } from "./langevals-provider-spend.service.ts";

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

/** `failureCode` set to a FastAPI error body's `detail.code` when langevals is known to send it. */
function recognisedFailureCode(body: string): { failureCode?: LangevalsClusteringFailureCode } {
  let code: unknown;
  try {
    code = (JSON.parse(body) as { detail?: { code?: unknown } } | null)?.detail?.code;
  } catch {
    return {};
  }
  const failureCode = LANGEVALS_CLUSTERING_FAILURE_CODES.find((known) => known === code);
  return failureCode === undefined ? {} : { failureCode };
}

/** Topic clustering's langevals exchange: main's `fetchTopics*Clustering` post and read. */
export class LangevalsClusteringService {
  static create(input: {
    endpoint: string | undefined;
    langevals: LangevalsChannel;
    staging: LangevalsPayloadStaging;
    /** Where the embedding and naming calls' provider usage is written; absent writes nothing. */
    spend?: Pick<LangevalsProviderSpendService, "record">;
  }): LangevalsClusteringService {
    return new LangevalsClusteringService(input);
  }

  private readonly endpoint: string | undefined;
  private readonly langevals: LangevalsChannel;
  private readonly staging: LangevalsPayloadStaging;
  private readonly spend: Pick<LangevalsProviderSpendService, "record"> | undefined;

  private constructor(input: {
    endpoint: string | undefined;
    langevals: LangevalsChannel;
    staging: LangevalsPayloadStaging;
    spend?: Pick<LangevalsProviderSpendService, "record">;
  }) {
    this.endpoint = input.endpoint;
    this.langevals = input.langevals;
    this.staging = input.staging;
    this.spend = input.spend;
  }

  async request(input: TopicClusteringRequest): Promise<TopicClusteringOutcome> {
    if (!this.endpoint) {
      logger.warn(
        { projectId: input.projectId },
        "Topic clustering service URL not set, skipping topic clustering",
      );
      return { kind: "not_configured" };
    }

    const route = CLUSTERING_ROUTES[input.mode];
    const startedAt = performance.now();
    const response = await this.langevals.post({
      url: `${this.endpoint}${route.path}`,
      body: input.params,
      projectId: input.projectId,
      kind: route.kind,
      staging: this.staging,
      signal: input.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new LangevalsClusteringError({
        mode: input.mode,
        status: response.status,
        statusText: response.statusText,
        body: excerptOf(body),
        ...recognisedFailureCode(body),
      });
    }

    const raw: unknown = await response.json();
    if (this.spend && typeof raw === "object" && raw !== null && "usage" in raw) {
      await this.spend.record({
        usage: raw.usage,
        projectId: input.projectId,
        requestType: "topic_clustering",
        requestKey: input.requestKey ?? generate("topicclustering").toString(),
        durationMs: performance.now() - startedAt,
      });
    }

    return { kind: "clustered", response: topicClusteringResponseSchema.parse(raw) };
  }
}
