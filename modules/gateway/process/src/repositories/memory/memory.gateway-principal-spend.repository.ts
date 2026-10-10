import type {
  GatewayPrincipalDailySpend,
  GatewayPrincipalModelSpend,
  GatewayPrincipalSpendSummary,
  GatewayPrincipalSpendWindow,
} from "@langwatch/gateway-contract";
import { Temporal } from "@langwatch/time";

import { GatewayPrincipalSpendRepository } from "../gateway-principal-spend.repository.ts";

/** One gateway request's principal-scope debit; a request debiting N budgets is seeded once. */
type PrincipalRequest = Readonly<{
  tenantId: string;
  userId: string;
  occurredAtMs: number;
  amountUsd: number;
  tokensInput: number;
  tokensOutput: number;
  model: string;
}>;

type PrincipalSpendInput = {
  tenantId: string;
  userId: string;
  window: GatewayPrincipalSpendWindow;
};

export class MemoryGatewayPrincipalSpendRepository extends GatewayPrincipalSpendRepository {
  readonly #requests: PrincipalRequest[] = [];

  static create(): MemoryGatewayPrincipalSpendRepository {
    return new MemoryGatewayPrincipalSpendRepository();
  }

  private constructor() {
    super();
  }

  record(request: PrincipalRequest): void {
    this.#requests.push(request);
  }

  async getSummary(input: PrincipalSpendInput): Promise<GatewayPrincipalSpendSummary> {
    const requests = this.#matching(input);
    if (requests.length === 0) {
      return {
        totalCost: 0,
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        topModel: null,
      };
    }
    const [top] = this.#countBy(requests, (request) => request.model).toSorted(
      (a, b) => b.requests - a.requests,
    );

    return {
      totalCost: requests.reduce((sum, request) => sum + request.amountUsd, 0),
      requestCount: requests.length,
      promptTokens: requests.reduce((sum, request) => sum + request.tokensInput, 0),
      completionTokens: requests.reduce((sum, request) => sum + request.tokensOutput, 0),
      topModel: top ? { name: top.key, requests: top.requests } : null,
    };
  }

  async findDailySpend(input: PrincipalSpendInput): Promise<GatewayPrincipalDailySpend[]> {
    return this.#countBy(this.#matching(input), (request) =>
      Temporal.Instant.fromEpochMilliseconds(request.occurredAtMs)
        .toZonedDateTimeISO("UTC")
        .toPlainDate()
        .toString(),
    )
      .map(({ key, spentUsd, requests }) => ({ day: key, spentUsd, billedUsd: spentUsd, requests }))
      .toSorted((a, b) => a.day.localeCompare(b.day));
  }

  async findModelSpend(input: PrincipalSpendInput): Promise<GatewayPrincipalModelSpend[]> {
    return this.#countBy(this.#matching(input), (request) => request.model)
      .map(({ key, spentUsd, requests }) => ({
        label: key,
        spentUsd,
        billedUsd: spentUsd,
        requests,
      }))
      .toSorted((a, b) => b.spentUsd - a.spentUsd);
  }

  #matching(input: PrincipalSpendInput): PrincipalRequest[] {
    return this.#requests.filter(
      (request) =>
        request.tenantId === input.tenantId &&
        request.userId === input.userId &&
        request.occurredAtMs >= input.window.startMs &&
        request.occurredAtMs < input.window.endMs,
    );
  }

  #countBy(
    requests: PrincipalRequest[],
    keyOf: (request: PrincipalRequest) => string,
  ): { key: string; spentUsd: number; requests: number }[] {
    const sums = new Map<string, { key: string; spentUsd: number; requests: number }>();
    for (const request of requests) {
      const key = keyOf(request);
      const sum = sums.get(key) ?? { key, spentUsd: 0, requests: 0 };
      sums.set(key, {
        key,
        spentUsd: sum.spentUsd + request.amountUsd,
        requests: sum.requests + 1,
      });
    }

    return [...sums.values()];
  }
}
