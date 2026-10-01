// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The cost screen's caveats: stopped sources, unpriced windows and the Azure bill note (ADR-128 §4a, ADR-088). */
import {
  copilotStudioStoredCursorSchema,
  deriveNoDataSinceNotice,
  type GovernanceCostSummary,
  type GovernanceIngestionSource,
} from "@langwatch/enterprise-governance-contract";
import type { Instant } from "@langwatch/time";

import type { UnpricedUsageSourceWindow } from "../repositories/ingestion-source.repository.ts";
import { extractClaimedSubscription } from "./azure-bill-ownership.rules.ts";

const isoOf = (at: Instant): string => at.toString({ fractionalSecondDigits: 3 });

/**
 * Main's `readStoredCostCursor`, over the puller's own whole-cursor schema: any malformed field reads
 * as no completed read, the same collapse a run applies. Older writers stored objects, so both parse.
 */
export function readStoredCostCursor(pollerCursor: unknown): {
  costPricedThroughDay: string | null;
  costHeldSinceMs: number | null;
} {
  const parsed = copilotStudioStoredCursorSchema.safeParse(storedCursorJson(pollerCursor));
  if (!parsed.success) return { costPricedThroughDay: null, costHeldSinceMs: null };
  return {
    costPricedThroughDay: parsed.data.costPricedThroughDay ?? null,
    costHeldSinceMs: parsed.data.costHeldSinceMs ?? null,
  };
}

/** The column is `Json?`: this build stores a string, older writers an object, unpulled null. */
function storedCursorJson(pollerCursor: unknown): unknown {
  let raw: string | undefined;
  if (typeof pollerCursor === "string") raw = pollerCursor;
  else if (pollerCursor !== null && typeof pollerCursor === "object") {
    raw = JSON.stringify(pollerCursor);
  }
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

type CostCaveats = Pick<GovernanceCostSummary, "staleSources" | "unpricedWindow" | "azureBilling">;

/** A claimed bill's read state; absent when no source claims one. */
export type AzureBillState = {
  isPrepaidDeclared: boolean;
  hasAzureSpendRows: boolean;
  costPricedThroughDay: string | null;
  costHeldSinceMs: number | null;
};

/** Dated from the OLDEST last success: the totals stop being complete at the first source that fell over. */
function staleSourcesOf(
  sources: readonly Pick<
    GovernanceIngestionSource,
    "name" | "status" | "errorCount" | "lastSuccessAt"
  >[],
): Pick<CostCaveats, "staleSources"> {
  const stopped = sources.flatMap((source) => {
    const notice = deriveNoDataSinceNotice({
      status: source.status,
      errorCount: source.errorCount,
      lastSuccessAt: source.lastSuccessAt ? source.lastSuccessAt.toISOString() : null,
    });
    if (notice === null || !("lastSuccessIso" in notice)) return [];
    return [{ name: source.name, lastSuccessIso: notice.lastSuccessIso }];
  });
  const [first, ...rest] = stopped;
  if (!first) return { staleSources: null };
  const oldest = rest.reduce(
    (earliest, candidate) =>
      candidate.lastSuccessIso < earliest.lastSuccessIso ? candidate : earliest,
    first,
  );
  return {
    staleSources: {
      oldestLastSuccessIso: oldest.lastSuccessIso,
      sourceNames: stopped.map((source) => source.name).toSorted(),
    },
  };
}

/** The window pulled while pulled cost recording was off, across every affected source. */
function unpricedWindowOf(
  windows: readonly UnpricedUsageSourceWindow[],
): Pick<CostCaveats, "unpricedWindow"> {
  const lost = windows.map((window) => ({
    name: window.name,
    since: window.since,
    through: window.through ?? window.since,
  }));
  const [first] = lost;
  if (!first) return { unpricedWindow: null };
  const since = lost.reduce(
    (earliest, source) =>
      source.since.epochMilliseconds < earliest.epochMilliseconds ? source.since : earliest,
    first.since,
  );
  const through = lost.reduce(
    (latest, source) =>
      source.through.epochMilliseconds > latest.epochMilliseconds ? source.through : latest,
    first.through,
  );
  return {
    unpricedWindow: {
      sinceIso: isoOf(since),
      throughIso: isoOf(through),
      sourceNames: lost.map((source) => source.name).toSorted(),
    },
  };
}

/** Why a claimed bill shows nothing; silent when there is no claim, spend is recorded, or no read finished. */
export function azureBillingOf(
  bill: AzureBillState | undefined,
): Pick<CostCaveats, "azureBilling"> {
  if (!bill || bill.hasAzureSpendRows) return { azureBilling: null };
  if (bill.costHeldSinceMs !== null) return { azureBilling: "billing_read_failed" };
  if (bill.costPricedThroughDay === null) return { azureBilling: null };
  return { azureBilling: bill.isPrepaidDeclared ? "prepaid_declared" : "no_spend_recorded" };
}

/** Sources claiming an Azure subscription, first-created first, as main's `createdAt asc` read orders them. */
export function claimingAzureSources<
  T extends Pick<GovernanceIngestionSource, "createdAt" | "parserConfig">,
>(sources: readonly T[]): T[] {
  return sources
    .filter((source) => extractClaimedSubscription(source.parserConfig) !== null)
    .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** The summary's three caveats: stopped sources, the unpriced window, and the Azure bill note. */
export function costCaveatsFrom({
  sources,
  unpricedWindows,
  azureBill,
}: {
  sources: readonly GovernanceIngestionSource[];
  unpricedWindows: readonly UnpricedUsageSourceWindow[];
  azureBill: AzureBillState | undefined;
}): CostCaveats {
  return {
    ...staleSourcesOf(sources),
    ...unpricedWindowOf(unpricedWindows),
    ...azureBillingOf(azureBill),
  };
}
