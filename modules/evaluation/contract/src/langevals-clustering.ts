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

/**
 * The stable codes langevals puts in `detail.code` when it can name a failure.
 * Anything else, including a bare-string detail, has no code.
 */
export const LANGEVALS_CLUSTERING_FAILURE_CODES = [
  "model_not_configured",
  "model_provider_auth_failed",
  "model_provider_bad_request",
  "model_provider_rate_limited",
] as const;
export type LangevalsClusteringFailureCode = (typeof LANGEVALS_CLUSTERING_FAILURE_CODES)[number];

/** langevals answered a clustering call with a non-2xx; the message carries its status and body. */
export class LangevalsClusteringError extends Error {
  readonly mode: TopicClusteringRequest["mode"];
  readonly status: number;
  readonly statusText: string;
  /** The code langevals named in `detail.code`, when it named one this contract knows. */
  readonly failureCode: LangevalsClusteringFailureCode | undefined;

  constructor(input: {
    mode: TopicClusteringRequest["mode"];
    status: number;
    statusText: string;
    body: string;
    failureCode?: LangevalsClusteringFailureCode;
  }) {
    super(
      `Failed to fetch topics ${input.mode} clustering (langevals): ${input.statusText}\n\n${input.body}`,
    );
    this.name = "LangevalsClusteringError";
    this.mode = input.mode;
    this.status = input.status;
    this.statusText = input.statusText;
    this.failureCode = input.failureCode;
  }
}
