import type {
  ConnectClassifyAnswer,
  ConnectCredential,
  ConnectUsageView,
} from "@langwatch/enterprise-licensing-contract";

/**
 * LangWatch-hosted services, as an install calls them: messages to a host this
 * deployment does not own, authenticated by the license it holds (ADR-156, §5).
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */
export abstract class ConnectGatewayChannel {
  /**
   * Judges one text on LangWatch. The install has no judge key of its own, so
   * the judgement happens there and is charged against the license's budget.
   */
  abstract classify(params: {
    credential: ConnectCredential;
    text: string;
    questions: readonly unknown[];
    signal?: AbortSignal;
  }): Promise<ConnectClassifyAnswer>;

  /** What this license is entitled to and what it has spent. */
  abstract usage(params: {
    credential: ConnectCredential;
    signal?: AbortSignal;
  }): Promise<ConnectUsageView>;

  /** Moves the customer's own cap, up to the maximum the contract allows. */
  abstract setBudget(params: {
    credential: ConnectCredential;
    capUsd: number;
    signal?: AbortSignal;
  }): Promise<{ capUsd: number; maximumCapUsd: number }>;
}
