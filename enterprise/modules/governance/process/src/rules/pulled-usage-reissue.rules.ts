// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { PulledUsageObservedEventData } from "@langwatch/enterprise-governance-contract";

/**
 * Where one charge is filed: the parts of its rollup cell that can move while its restatement key
 * stays the same. The day it sat in is carried because a withdrawal is dated to the day it corrects.
 */
export interface FiledCell {
  model: string;
  currencyCode: string;
  agentId: string;
  rawActorId: string;
  occurredAtMs: number;
}

/** Where the charge sits NOW, which is what the next version is compared against. */
export function filedCellFor(record: PulledUsageObservedEventData): FiledCell {
  return {
    model: record.model,
    currencyCode: record.currencyCode,
    agentId: record.agentId,
    rawActorId: record.rawActorId,
    occurredAtMs: record.occurredAtMs,
  };
}

/**
 * A reissue moves the currency, the agent or the spender - the three the restatement key excludes.
 * Never the model: two models of one period can share a key, and withdrawing then destroys real spend.
 */
export function isReissuedElsewhere(
  filed: FiledCell,
  next: Pick<PulledUsageObservedEventData, "currencyCode" | "agentId" | "rawActorId">,
): boolean {
  return (
    filed.currencyCode !== next.currencyCode ||
    filed.agentId !== next.agentId ||
    filed.rawActorId !== next.rawActorId
  );
}
