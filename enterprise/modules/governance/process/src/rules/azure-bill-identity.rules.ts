// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { extractClaimedSubscription } from "./azure-bill-ownership.rules.ts";

const SOURCE_FIELD = "_azureBillSourceId";
const SUBSCRIPTION_FIELD = "_azureBillSubscriptionId";
type Config = Record<string, unknown>;

/** A source that has, or once had, an Azure bill claim: the rows the identity is read from. */
export interface AzureBillHistoryEntry {
  id: string;
  parserConfig: unknown;
}

/** The first source remains the bill's storage identity across replacements. */
export function azureBillSourceId(source: { id: string; parserConfig?: unknown }): string {
  const value = readField(source.parserConfig, SOURCE_FIELD);
  return typeof value === "string" && value !== "" ? value : source.id;
}

function readField(config: unknown, field: string): unknown {
  if (typeof config !== "object" || config === null) return undefined;
  return Object.entries(config).find(([key]) => key === field)?.[1];
}

function deriveSubscriptionIdentity(config: unknown): string | null {
  const value = readField(config, SUBSCRIPTION_FIELD);
  return typeof value === "string" ? value : extractClaimedSubscription(config);
}

/**
 * Internal fields are server-owned and excluded from source responses. Keep
 * the subscription identity even when billing is disconnected: its recorded
 * money still exists, and a later connection must restate those same rows.
 * Legacy sources need no backfill; their own id and claim are the identity.
 */
export function withAzureBillIdentity({
  parserConfig,
  sourceId,
  storedConfig,
  history,
}: {
  parserConfig: Config;
  sourceId?: string;
  storedConfig?: Config;
  /** The organisation's Copilot Studio sources, archived included; read only when a claim is made. */
  history: readonly AzureBillHistoryEntry[];
}): Config {
  const config = { ...parserConfig };
  delete config[SOURCE_FIELD];
  delete config[SUBSCRIPTION_FIELD];
  const claimed = extractClaimedSubscription(config)?.toLowerCase();
  const stored = deriveSubscriptionIdentity(storedConfig ?? null)?.toLowerCase();

  if (sourceId && stored && (!claimed || claimed === stored)) {
    config[SOURCE_FIELD] = azureBillSourceId({
      id: sourceId,
      parserConfig: storedConfig,
    });
    config[SUBSCRIPTION_FIELD] = stored;
    return config;
  }
  if (!claimed) return config;

  const owner = historicalOwners({ claimed, sourceId, history })[0] ?? sourceId;
  if (owner) config[SOURCE_FIELD] = owner;
  config[SUBSCRIPTION_FIELD] = claimed;
  return config;
}

/** A claim whose subscription already has two billing histories cannot say which to restate. */
export function findAzureBillHistoryComplaints({
  parserConfig,
  sourceId,
  storedConfig,
  history,
}: {
  parserConfig: Config;
  sourceId?: string;
  storedConfig?: Config;
  history: readonly AzureBillHistoryEntry[];
}): string[] {
  const claimed = extractClaimedSubscription(parserConfig)?.toLowerCase();
  const stored = deriveSubscriptionIdentity(storedConfig ?? null)?.toLowerCase();
  if (sourceId && stored && (!claimed || claimed === stored)) return [];
  if (!claimed || historicalOwners({ claimed, sourceId, history }).length <= 1) return [];
  return [
    "This Azure subscription has multiple billing histories. Reconcile the existing records before connecting it again to avoid duplicate spend.",
  ];
}

function historicalOwners({
  claimed,
  sourceId,
  history,
}: {
  claimed: string;
  sourceId?: string;
  history: readonly AzureBillHistoryEntry[];
}): string[] {
  const owners = history
    .filter(
      (row) =>
        row.id !== sourceId &&
        deriveSubscriptionIdentity(row.parserConfig)?.toLowerCase() === claimed,
    )
    .map(azureBillSourceId);
  return [...new Set(owners)];
}
