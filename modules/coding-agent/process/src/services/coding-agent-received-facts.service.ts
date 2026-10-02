import type { CanonicalLogRecord } from "@langwatch/log-contract";
import type { CanonicalMetricDataPoint } from "@langwatch/metric-contract";
import type { TraceApi } from "@langwatch/trace-contract";

import { liftLogContribution } from "../rules/coding-agent-log-facts.rules.ts";
import { liftMetricContribution } from "../rules/coding-agent-metric-facts.rules.ts";
import type { CodingAgentCommandDispatcherService } from "./coding-agent-command-dispatcher.service.ts";

/** Lifts received log records and metric points into session facts, as main's dispatch did. */
export class CodingAgentReceivedFactsService {
  private constructor(
    private readonly traces: TraceApi,
    private readonly commands: CodingAgentCommandDispatcherService,
  ) {}

  static create({
    traces,
    commands,
  }: {
    traces: TraceApi;
    commands: CodingAgentCommandDispatcherService;
  }): CodingAgentReceivedFactsService {
    return new CodingAgentReceivedFactsService(traces, commands);
  }

  async contributeReceivedLogRecord(record: CanonicalLogRecord): Promise<void> {
    const lifted = liftLogContribution({ record, traces: this.traces });
    if (lifted.outcome === "ignored") return;
    await this.commands.contributeLogFacts(lifted.contribution);
  }

  async contributeReceivedMetricPoint(point: CanonicalMetricDataPoint): Promise<void> {
    const lifted = liftMetricContribution(point);
    if (lifted.outcome === "ignored") return;
    await this.commands.contributeMetricFacts(lifted.contribution);
  }
}
