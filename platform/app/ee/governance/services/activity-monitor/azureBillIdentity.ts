// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { ValidationError } from "@langwatch/handled-error";
import type { PrismaClient } from "~/generated/prisma/client";
import { readClaimedSubscription } from "./azureBillOwnership";

const SOURCE_FIELD = "_azureBillSourceId";
const SUBSCRIPTION_FIELD = "_azureBillSubscriptionId";
type Config = Record<string, unknown>;

/** The first source remains the bill's storage identity across replacements. */
export function azureBillSourceId(source: {
  id: string;
  parserConfig?: unknown;
}): string {
  const value = (source.parserConfig as Config | null)?.[SOURCE_FIELD];
  return typeof value === "string" && value !== "" ? value : source.id;
}

function subscriptionIdentity(config: Config | null): string | null {
  const value = config?.[SUBSCRIPTION_FIELD];
  return typeof value === "string" ? value : readClaimedSubscription(config);
}

/**
 * Internal fields are server-owned and excluded from source responses. Keep
 * the subscription identity even when billing is disconnected: its recorded
 * money still exists, and a later connection must restate those same rows.
 * Legacy sources need no backfill; their own id and claim are the identity.
 */
export async function withAzureBillIdentity({
  prisma,
  organizationId,
  parserConfig,
  sourceId,
  storedConfig,
}: {
  prisma: PrismaClient;
  organizationId: string;
  parserConfig: Config;
  sourceId?: string;
  storedConfig?: Config;
}): Promise<Config> {
  const config = { ...parserConfig };
  delete config[SOURCE_FIELD];
  delete config[SUBSCRIPTION_FIELD];
  const claimed = readClaimedSubscription(config)?.toLowerCase();
  const stored = subscriptionIdentity(storedConfig ?? null)?.toLowerCase();

  if (sourceId && stored && (!claimed || claimed === stored)) {
    config[SOURCE_FIELD] = azureBillSourceId({
      id: sourceId,
      parserConfig: storedConfig,
    });
    config[SUBSCRIPTION_FIELD] = stored;
    return config;
  }
  if (!claimed) return config;

  const history = await prisma.ingestionSource.findMany({
    where: { organizationId, sourceType: "copilot_studio_dataverse" },
    select: { id: true, parserConfig: true },
  });
  const owners = new Set(
    history
      .filter(
        (row) =>
          row.id !== sourceId &&
          subscriptionIdentity(
            row.parserConfig as Config | null,
          )?.toLowerCase() === claimed,
      )
      .map(azureBillSourceId),
  );
  if (owners.size > 1) {
    const message =
      "This Azure subscription has multiple billing histories. Reconcile the existing records before connecting it again to avoid duplicate spend.";
    throw new ValidationError(message, { meta: { formErrors: [message] } });
  }
  const owner = owners.values().next().value ?? sourceId;
  if (owner) config[SOURCE_FIELD] = owner;
  config[SUBSCRIPTION_FIELD] = claimed;
  return config;
}
