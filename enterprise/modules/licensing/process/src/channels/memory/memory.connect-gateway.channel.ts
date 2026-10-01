import type {
  ConnectClassifyAnswer,
  ConnectCredential,
  ConnectUsageView,
} from "@langwatch/enterprise-licensing-contract";

import { ConnectGatewayChannel } from "../connect-gateway.channel.ts";

export interface MemoryConnectGatewayChannelOptions {
  /** What `usage` answers, or the refusal it raises. */
  readonly usage?: ConnectUsageView | Error;
  /** What `classify` answers, or the refusal it raises. */
  readonly classification?: ConnectClassifyAnswer | Error;
  /** The maximum a cap may be set to, for the answer `setBudget` gives. */
  readonly maximumCapUsd?: number;
}

/**
 * The hosted services, answering from memory. Holds the cap it was last set to,
 * so a suite can assert a change reached the host rather than only the form.
 */
export class MemoryConnectGatewayChannel extends ConnectGatewayChannel {
  readonly classifications: { text: string; token: string; instanceId: string }[] = [];
  #capUsd = 0;

  private constructor(private readonly options: MemoryConnectGatewayChannelOptions) {
    super();
  }

  static create(options: MemoryConnectGatewayChannelOptions = {}): MemoryConnectGatewayChannel {
    return new MemoryConnectGatewayChannel(options);
  }

  get capUsd(): number {
    return this.#capUsd;
  }

  async classify({
    credential,
    text,
  }: {
    credential: ConnectCredential;
    text: string;
    questions: readonly unknown[];
    signal?: AbortSignal;
  }): Promise<ConnectClassifyAnswer> {
    this.classifications.push({
      text,
      token: credential.token,
      instanceId: credential.instanceId,
    });
    const answer = this.options.classification;
    if (answer instanceof Error) throw answer;
    return (
      answer ?? {
        verdicts: [],
        inputTokens: 0,
        isTextTruncated: false,
        chargedUsd: 0,
      }
    );
  }

  async usage(_params: {
    credential: ConnectCredential;
    signal?: AbortSignal;
  }): Promise<ConnectUsageView> {
    const answer = this.options.usage;
    if (answer instanceof Error) throw answer;
    return (
      answer ?? {
        services: [],
        spendAvailable: false,
        readAt: "1970-01-01T00:00:00.000Z",
        contract: null,
        budgets: [],
      }
    );
  }

  async setBudget({
    capUsd,
  }: {
    credential: ConnectCredential;
    capUsd: number;
    signal?: AbortSignal;
  }): Promise<{ capUsd: number; maximumCapUsd: number }> {
    this.#capUsd = capUsd;
    return { capUsd, maximumCapUsd: this.options.maximumCapUsd ?? capUsd };
  }
}
