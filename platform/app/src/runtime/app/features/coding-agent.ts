import {
  CodingAgentBillingPolicyPort,
  CodingAgentClickHousePort,
  CodingAgentReadMetricsPort,
  type CodingAgentSessionListReadOutcome,
} from "@langwatch/coding-agent-server";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { observeCodingAgentSessionListReadDuration } from "~/server/metrics";

/** Adapts app ClickHouse routing for the process-owned Coding Agent runtime. */
export class AppCodingAgentClickHousePort extends CodingAgentClickHousePort {
  static create(resolveClient: ClickHouseClientResolver): AppCodingAgentClickHousePort {
    return new AppCodingAgentClickHousePort(resolveClient);
  }

  private constructor(private readonly resolveClient: ClickHouseClientResolver) {
    super();
  }

  resolve(tenantId: string) {
    return this.resolveClient(tenantId);
  }
}

/** Preserves the existing bounded session-list read metric at the app edge. */
export class AppCodingAgentReadMetricsPort extends CodingAgentReadMetricsPort {
  static create(): AppCodingAgentReadMetricsPort {
    return new AppCodingAgentReadMetricsPort();
  }

  private constructor() {
    super();
  }

  observeSessionListRead(input: {
    table: string;
    outcome: CodingAgentSessionListReadOutcome;
    durationMs: number;
  }): void {
    observeCodingAgentSessionListReadDuration(input);
  }
}

/** Names the app's complete governance capability as Coding Agent's billing policy. */
export class AppCodingAgentBillingPolicy extends CodingAgentBillingPolicyPort {
  static create(governance: GovernanceService): AppCodingAgentBillingPolicy {
    return new AppCodingAgentBillingPolicy(governance);
  }

  private constructor(private readonly governance: GovernanceService) {
    super();
  }

  isSourceNonBillable(input: {
    organizationId: string;
    sourceType: string;
  }): Promise<boolean> {
    return this.governance.resolveSourceNonBillable(input);
  }
}
