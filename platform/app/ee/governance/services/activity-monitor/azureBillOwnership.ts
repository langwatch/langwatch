// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Who is allowed to read an Azure subscription's bill.
 *
 * Azure Cost Management reports spend for a whole subscription, not for the one
 * environment a source happens to watch. Everything below the read stores that
 * figure against the source that fetched it: the ledger keys on the source, and
 * the daily rollup carries the source id in its row identity. So two sources
 * naming one subscription file the same bill twice, and the organisation's
 * total reports double what Azure charged. Both entries are individually
 * correct, which is what makes it dangerous — the mismatch check guarding the
 * rollup compares a figure against itself and never fires, and nothing else
 * surfaces the difference.
 *
 * The remedy here is the narrow one: at most one source may name a given
 * subscription, refused on the write rather than at pull time, because by pull
 * time the admin is long gone and the only signal left is a wrong number on a
 * dashboard. It costs an organisation running two environments on one
 * subscription the ability to name it twice; they choose which source carries
 * the bill and the other reads conversations only.
 *
 * The wider fix is the bill as its own connection, owned per subscription
 * rather than per environment, which also lets it run on the daily schedule the
 * data is actually published on. That is tracked separately; this guard is what
 * stops the numbers lying in the meantime.
 */

import { ValidationError } from "@langwatch/handled-error";

/** The config key naming the Azure subscription a source reads the bill of. */
export const AZURE_SUBSCRIPTION_FIELD = "azureSubscriptionId";

/** A source that already reads some subscription's bill. */
export interface AzureBillReader {
  id: string;
  name: string;
  subscriptionId: string;
}

/**
 * The subscription a config claims the bill of, or null when it claims none.
 *
 * Blank reads as "none" rather than as a subscription named the empty string,
 * which would have every source without a subscription collide with every other
 * one. The composer already drops an empty field before it builds the config
 * (`inventory.tsx`), so this is not fixing a live escape — it holds because
 * anything reaching the service directly, without going through that form, is
 * under no such obligation.
 */
export function readClaimedSubscription(
  parserConfig: Record<string, unknown> | null | undefined,
): string | null {
  if (!parserConfig || typeof parserConfig !== "object") return null;
  const claimed = parserConfig[AZURE_SUBSCRIPTION_FIELD];
  if (typeof claimed !== "string") return null;
  const trimmed = claimed.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Refuse a save that names a subscription without the bill's own credential.
 *
 * The bill is read with its own registered app — one that holds Cost
 * Management Reader and cannot read a conversation — and never with the
 * conversation credential (ADR-128 §21.1). Enforcing that at save time is
 * what keeps the state "subscription named, bill unreadable forever" from
 * existing at all: refused here, it never needs explaining on a spend panel
 * months later to someone who was not in the room when the source was made.
 *
 * Only a save that carries readable credentials is judged. An edit does not
 * resend secrets — the service carries the stored, already-validated envelope
 * across, so by the time this guard runs the credentials are absent or an
 * encrypted string, and refusing either would lock an admin out of renaming
 * their own source. A create that carries no credentials at all cannot read
 * conversations either; that save fails for the louder reason.
 */
export function assertAzureBillHasItsOwnCredential(params: {
  parserConfig: Record<string, unknown> | null | undefined;
}): void {
  const { parserConfig } = params;
  if (readClaimedSubscription(parserConfig) === null) return;

  const credentials = parserConfig?.credentials;
  if (
    typeof credentials !== "object" ||
    credentials === null ||
    Array.isArray(credentials)
  ) {
    return;
  }

  const readBillingKey = (key: string): string => {
    const value = (credentials as Record<string, unknown>)[key];
    return typeof value === "string" ? value.trim() : "";
  };
  if (
    readBillingKey("billingClientId") &&
    readBillingKey("billingClientSecret")
  ) {
    return;
  }

  const complaint =
    "Reading this subscription's bill needs its own app registration — a billing client ID and secret holding the Cost Management Reader role. The conversation credential is never used for the bill, so without the billing pair the spend would stay unreadable. Add both billing fields, or leave the subscription empty.";
  throw new ValidationError(complaint, {
    meta: { formErrors: [complaint] },
  });
}

/**
 * Refuse a config claiming a subscription another live source already reads.
 *
 * A no-op for a config claiming no subscription — silence here means "nothing
 * claimed", never "checked and fine".
 *
 * `sourceId` is the source being written. It is excluded from its own check so
 * that renaming a source, or any other edit that resends the subscription it
 * already holds, does not make it collide with itself.
 *
 * Identifiers are compared without regard to case or surrounding space. Azure
 * prints them lower case and accepts either spelling, so a pasted capitalised
 * identifier names the same subscription and the same bill; comparing them
 * literally would let the second reader straight through.
 *
 * `claimedBy` is passed in rather than read here so that the whole decision is
 * one pure function. The alternative — a database filter on a JSON field —
 * would put the matching rules somewhere that silently returns nothing when
 * they are wrong, which is the one failure this guard cannot afford.
 */
export function assertAzureBillNotAlreadyClaimed(params: {
  parserConfig: Record<string, unknown> | null | undefined;
  claimedBy: AzureBillReader[];
  sourceId?: string;
}): void {
  const { parserConfig, claimedBy, sourceId } = params;

  const claimed = readClaimedSubscription(parserConfig);
  if (claimed === null) return;

  const wanted = claimed.toLowerCase();
  const owner = claimedBy.find(
    (reader) =>
      reader.id !== sourceId &&
      reader.subscriptionId.trim().toLowerCase() === wanted,
  );
  if (!owner) return;

  // The complaint travels in `meta.formErrors` because that is the half of the
  // `validation_error` contract the presentation layer reads for a field it has
  // no on-screen name for. Without it the admin gets the generic "Check your
  // input" copy and never learns which source already holds the subscription —
  // which is the entire point of naming the owner here (see
  // `unsupportedValue.ts` for the same trap spelled out).
  const complaint = `The source "${owner.name}" already reads this Azure subscription's bill. A subscription's bill covers everything running under it, so reading it from two sources would report double the spend. Leave the subscription empty here, or name a different one.`;
  throw new ValidationError(complaint, {
    meta: { formErrors: [complaint] },
  });
}
