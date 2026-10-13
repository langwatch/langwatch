import type {
  BatchClusteringParams,
  IncrementalClusteringParams,
  TopicClusteringResponse,
} from "@langwatch/topic-contract";

/** One topic-clustering call to langevals; the signal bounds the whole exchange. */
export type TopicClusteringRequest = Readonly<{ projectId: string; signal: AbortSignal }> &
  (
    | Readonly<{ mode: "batch"; params: BatchClusteringParams }>
    | Readonly<{ mode: "incremental"; params: IncrementalClusteringParams }>
  );

/** `not_configured`: this deployment names no langevals endpoint, so nothing was sent. */
export type TopicClusteringOutcome =
  | Readonly<{ kind: "clustered"; response: TopicClusteringResponse }>
  | Readonly<{ kind: "not_configured" }>;

/** langevals answered a clustering call with a non-2xx; the message carries its status and body. */
export class LangevalsClusteringError extends Error {
  readonly mode: TopicClusteringRequest["mode"];
  readonly statusText: string;

  constructor(input: { mode: TopicClusteringRequest["mode"]; statusText: string; body: string }) {
    super(
      `Failed to fetch topics ${input.mode} clustering (langevals): ${input.statusText}\n\n${input.body}`,
    );
    this.name = "LangevalsClusteringError";
    this.mode = input.mode;
    this.statusText = input.statusText;
  }
}
