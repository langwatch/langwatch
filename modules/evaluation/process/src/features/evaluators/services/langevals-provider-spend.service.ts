/**
 * Writes the provider usage langevals reports to the gateway spend ledger (ADR-193). Best
 * effort by design: the evaluation already ran and was billed by the provider, so a ledger
 * failure is logged with every figure and never turns a verdict into an error.
 */
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { EvaluationProviderSpend } from "../../../channels/evaluation.channels.ts";
import { langevalsProviderUsagesOf } from "../../../rules/langevals-provider-usage.rules.ts";

const logger = createLogger("langwatch:evaluation:provider-spend");

export class LangevalsProviderSpendService {
  static create(input: { spend: EvaluationProviderSpend }): LangevalsProviderSpendService {
    return new LangevalsProviderSpendService(input.spend);
  }

  private constructor(private readonly spend: EvaluationProviderSpend) {}

  async record(input: {
    usage: unknown;
    projectId: string;
    requestType: string;
    requestKey: string;
    durationMs: number;
  }): Promise<void> {
    const entries = langevalsProviderUsagesOf({
      ...input,
      occurredAt: nowInstant().epochMilliseconds,
    });
    for (const entry of entries) {
      try {
        const { status } = await this.spend.recordProviderUsage(entry);
        if (status !== "recorded") {
          logger.error({ ...entry, status }, "langevals provider usage not written to the ledger");
        }
      } catch (error) {
        logger.error({ ...entry, error }, "langevals provider usage not written to the ledger");
      }
    }
  }
}
