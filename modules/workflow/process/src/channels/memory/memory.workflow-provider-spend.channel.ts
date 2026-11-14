import type { GatewayProviderUsage, GatewayProviderUsageResult } from "@langwatch/gateway-contract";

import type { WorkflowProviderSpend } from "../workflow.channels.ts";

/** The spend ledger's twin: every usage it is handed, in order, answered as `answer` says. */
export class MemoryWorkflowProviderSpendChannel implements WorkflowProviderSpend {
  readonly recorded: GatewayProviderUsage[] = [];

  static create(
    input: { answer?: () => Promise<GatewayProviderUsageResult> } = {},
  ): MemoryWorkflowProviderSpendChannel {
    return new MemoryWorkflowProviderSpendChannel(
      input.answer ?? (() => Promise.resolve({ status: "recorded" })),
    );
  }

  private constructor(private readonly answer: () => Promise<GatewayProviderUsageResult>) {}

  recordProviderUsage(input: GatewayProviderUsage): Promise<GatewayProviderUsageResult> {
    this.recorded.push(input);
    return this.answer();
  }
}
