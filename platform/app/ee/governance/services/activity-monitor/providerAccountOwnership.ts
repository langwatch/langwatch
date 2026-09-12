// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Who is allowed to read a provider account's spend.
 *
 * The third arm of the same rule as {@link ./azureBillOwnership.ts} and
 * {@link ./environmentOwnership.ts}, and the one that cannot read its identity
 * off the form. Azure and Power Platform name what they read in the config, so
 * those guards compare a field an admin typed. OpenAI and Anthropic name
 * nothing: an administrator key reads the whole organisation's spend and the
 * admin never types which organisation that is.
 *
 * So the account is ASKED FOR while the connection is being saved, and the
 * answer — the provider's own account id — is what is compared and what is
 * kept. Two consequences fall out of asking rather than comparing keys:
 *
 * - A second key belonging to the same organisation is refused even though it
 *   is a different secret. One organisation holds several administrator keys —
 *   a rotation overlap, a second admin, a service key beside a personal one —
 *   and every one of them reads the same spend. Comparing the keys to each
 *   other refuses none of these.
 * - Nothing derived from the key needs to be stored for the guard to work. The
 *   account id is not a secret and cannot be turned back into a key, so there
 *   is no hash, digest or fingerprint column and no promise about a customer
 *   credential that we would then have to keep. That claim is pinned by
 *   `__tests__/providerAccountSchema.unit.test.ts`, which reads the model.
 *
 * The report is part of the identity because two reports about one account
 * cannot bill the same money twice — one connection reads token usage, another
 * reads spend, and refusing that pair leaves a customer who wants both having
 * to pick one (00d claim C, settlement 8).
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 * Decision: 00d claim C, settlements 6, 7 and 8; 00i items 5, 6 and 7.
 */

import { ValidationError } from "@langwatch/handled-error";

/**
 * The source types whose identity is an account the provider reports.
 *
 * Its own table rather than the one in
 * `dashboard/components/environments/discoveredEnvironments.ts`, and knowingly
 * so: server code may not value-import from `components/**` (the boundary is
 * enforced by `src/server/__tests__/frontend-boundary.unit.test.ts`), and
 * moving that table to a framework-free home is a change nothing in this batch
 * needs. Two small tables that must agree; deduping them is on the backlog
 * (00i settlement 7).
 *
 * The two compliance source types are deliberately absent. They authenticate
 * against a different surface that publishes no organisation read, so there is
 * no account to ask for and a guard that demanded one would refuse every save.
 */
const PROVIDER_ACCOUNT_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "openai_admin",
  "anthropic_admin",
]);

/** Whether a source of this type reads an account the provider can name. */
export function readsProviderAccount({
  sourceType,
}: {
  sourceType: string;
}): boolean {
  return PROVIDER_ACCOUNT_SOURCE_TYPES.has(sourceType);
}

/**
 * Whether there is a key on this config to ask the provider about.
 *
 * A connection carrying no administrator key holds no account: it cannot read
 * anything, so it cannot be reading the same spend as anything else, and there
 * is nothing to ask with. Refusing such a save instead would break every edit
 * of a connection whose key has not been entered yet, for no gain — the moment
 * the key arrives the save goes through this guard and the account is claimed
 * then.
 *
 * Both shapes count: a fresh secret object from the form, and the sealed
 * envelope the service carries across on an edit that does not resend it.
 */
export function hasAdminCredentials(
  parserConfig: Record<string, unknown> | null | undefined,
): boolean {
  const credentials = parserConfig?.credentials;
  if (typeof credentials === "string") return credentials.trim() !== "";
  if (!credentials || typeof credentials !== "object") return false;
  return Object.keys(credentials).length > 0;
}

/**
 * The provider, answering which account a key belongs to.
 *
 * A port rather than a direct call so the service's dependency on the provider
 * is visible at its seam and a test can stand in front of it without reaching
 * for the module loader (ADR-047). The live implementation is
 * {@link ./providerAccountLookup.ts}.
 */
export type LookUpProviderAccount = (params: {
  sourceType: string;
  parserConfig: Record<string, unknown>;
}) => Promise<string>;

/**
 * A source that already reads some provider account.
 *
 * `disabled` is this guard's own vocabulary, not the column. `IngestionSource`
 * carries a `status` string, and the service maps it here — deliberately, and
 * in one place, because only ARCHIVING gives an account up. Every other status
 * still holds the claim, so the mapping cannot be inferred from status names
 * that merely sound inactive (00i settlement 5).
 */
export interface ProviderAccountReader {
  id: string;
  name: string;
  providerAccountId: string | null;
  /** `usage` or `cost` on the sources that have one; null when unset. */
  report: string | null;
  disabled: boolean;
}

/** The config key naming which report of an account a source reads. */
export const REPORT_FIELD = "report";

function readReport(
  parserConfig: Record<string, unknown> | null | undefined,
): string | null {
  const value = parserConfig?.[REPORT_FIELD];
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

function normalizeReport(report: string | null): string | null {
  if (typeof report !== "string") return null;
  const trimmed = report.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/**
 * Refuse a save whose account another live connection already reads.
 *
 * The provider is asked first, on every save, and the answer is returned so the
 * caller can store it — the account is resolved once per save rather than once
 * per connection, and create and edit go through the same call.
 *
 * A failed call fails the save. Letting it through unchecked is the same as
 * having no guard at all: the next save has nothing to compare against, and
 * the two connections then read the same bill for as long as they both live.
 * The refusal says so in plain words and names no internals — what went wrong
 * upstream belongs in the log, not in copy an admin reads.
 *
 * `claimedBy` holds every connection in the organisation that is not archived,
 * disabled ones included. `sourceId` is the connection being written, excluded
 * from its own check so a rename does not collide with itself.
 */
export async function assertProviderAccountIsFree(params: {
  sourceType: string;
  parserConfig: Record<string, unknown> | null | undefined;
  claimedBy: ProviderAccountReader[];
  sourceId?: string;
  lookUpProviderAccount: LookUpProviderAccount;
}): Promise<{ providerAccountId: string }> {
  const { sourceType, parserConfig, claimedBy, sourceId } = params;

  let providerAccountId: string;
  try {
    providerAccountId = await params.lookUpProviderAccount({
      sourceType,
      parserConfig: parserConfig ?? {},
    });
  } catch {
    // Deliberately swallowing the upstream error rather than wrapping it: it
    // may carry a request URL, a header or a response body, and this sentence
    // is rendered verbatim to the admin. The cause is logged by the lookup.
    throw refusal(
      "We could not confirm which account this key belongs to, so the connection was not saved. Check the key is an administrator key that is still valid, then try again.",
    );
  }

  const wantedReport = readReport(parserConfig);
  const owner = claimedBy.find(
    (reader) =>
      reader.id !== sourceId &&
      reader.providerAccountId === providerAccountId &&
      normalizeReport(reader.report) === wantedReport,
  );
  if (!owner) return { providerAccountId };

  // Nothing about either key appears here, and nothing can: this guard is never
  // given one. It compares the account the provider reported, and the only
  // customer-supplied text it repeats is the name of a connection the admin
  // wrote themselves.
  throw refusal(
    owner.disabled
      ? `The connection "${owner.name}" already reads this account. It is switched off, but a connection that is off still holds the account it read — the day it is switched back on, the two of them start counting the same spend. Archive that connection first, or point this one at a different account.`
      : `The connection "${owner.name}" already reads this account. Two connections onto one account report the same spend twice, and both figures look right on their own. Archive that connection, or point this one at a different account.`,
  );
}

/**
 * The refusal shape, in one place.
 *
 * The sentence travels in `meta.formErrors` as well as the message because that
 * is the half of the `validation_error` contract the presentation layer reads
 * for a field it has no on-screen name for. Without it the admin gets the
 * generic "Check your input" copy and never learns which connection holds the
 * account, which is the entire point of naming the owner.
 */
function refusal(complaint: string): ValidationError {
  return new ValidationError(complaint, {
    meta: { formErrors: [complaint] },
  });
}
