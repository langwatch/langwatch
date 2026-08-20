/**
 * The rule every dogfood seeder follows when it lands a provider credential.
 *
 * A seeder runs against whatever organization the operator points it at, and
 * a development organization is shared. Provider rows are org-wide, so a
 * seeder that writes the key it read from the shell replaces a credential
 * other people are using, with whatever happened to be exported in that
 * terminal. There is no undo: the previous key is encrypted in the column the
 * write just overwrote.
 *
 * So seeding fills a gap. A row with no usable credential gets one, a row
 * that already has one is left alone, and replacing takes `--force-keys`.
 *
 * Read the key from `platform/app/.env`, which is where the model provider
 * keys for this app live. An env file from another repository drifts, and a
 * stale key from one is indistinguishable from a fresh one once it is in the
 * column.
 */
import { decrypt } from "~/utils/encryption";

export type StoredCredential =
  | { state: "absent" }
  | { state: "present"; keys: Record<string, unknown> }
  | { state: "unreadable" };

/**
 * What a `ModelProvider.customKeys` column is holding. Rows exist in three
 * shapes: an encrypted string, a plain object from before encryption, and
 * null. An empty object counts as absent, since that is what a row created
 * without a key looks like.
 */
export function readStoredCredential(customKeys: unknown): StoredCredential {
  if (customKeys === null || customKeys === undefined) {
    return { state: "absent" };
  }

  if (typeof customKeys === "string") {
    if (customKeys.trim() === "") return { state: "absent" };
    try {
      const parsed = JSON.parse(decrypt(customKeys)) as Record<string, unknown>;
      return hasAnyValue(parsed)
        ? { state: "present", keys: parsed }
        : { state: "absent" };
    } catch {
      return { state: "unreadable" };
    }
  }

  if (typeof customKeys === "object") {
    const keys = customKeys as Record<string, unknown>;
    return hasAnyValue(keys) ? { state: "present", keys } : { state: "absent" };
  }

  return { state: "absent" };
}

function hasAnyValue(keys: Record<string, unknown>): boolean {
  return Object.values(keys).some(
    (value) => typeof value === "string" && value.trim() !== "",
  );
}

/**
 * Three outcomes, because an unreadable credential is not the same as a good
 * one.
 *
 * `write` fills an empty row, or replaces on an explicit force.
 * `keep` leaves a working credential in place. The row is still usable, so a
 * seeder may enable it and route to it.
 * `skip` is for a blob that cannot be decrypted, usually a row written under
 * a different CREDENTIALS_SECRET. Somebody put a credential there, so a
 * script must not overwrite it, but nothing can dispatch with it either.
 * Enabling such a row makes every request through it fail at credential
 * materialisation, so a seeder must leave it alone and report it.
 */
export type CredentialWriteDecision =
  | { action: "write"; reason: "no stored credential" }
  | { action: "write"; reason: "forced" }
  | { action: "keep"; reason: "a credential is already stored" }
  | { action: "skip"; reason: "the stored credential cannot be read" }
  | { action: "skip"; reason: "nothing to write" };

export function decideCredentialWrite({
  stored,
  replacement,
  shouldForce,
}: {
  stored: StoredCredential;
  /**
   * The plaintext key this run has in hand, or null when the environment
   * variable behind the provider is unset.
   */
  replacement: Record<string, unknown> | null;
  shouldForce: boolean;
}): CredentialWriteDecision {
  // Nothing to seed. Forcing swaps one key for another and is never a way to
  // empty the column, so a run with an unset environment variable leaves the
  // row exactly as it found it. This is the rule, in one place, because both
  // seeders and their tests have to agree on it.
  const hasReplacement =
    Boolean(replacement) && Object.keys(replacement ?? {}).length > 0;
  if (!hasReplacement) {
    // Nothing stored and nothing to write leaves a row that cannot serve a
    // request. It is skipped rather than kept, so a seeder does not enable it
    // or route to it on the strength of having left it alone.
    if (stored.state === "absent") {
      return { action: "skip", reason: "nothing to write" };
    }
    if (stored.state === "unreadable") {
      return { action: "skip", reason: "the stored credential cannot be read" };
    }
    return { action: "keep", reason: "a credential is already stored" };
  }

  if (stored.state === "absent") {
    return { action: "write", reason: "no stored credential" };
  }
  if (shouldForce) return { action: "write", reason: "forced" };
  if (stored.state === "unreadable") {
    return { action: "skip", reason: "the stored credential cannot be read" };
  }
  return { action: "keep", reason: "a credential is already stored" };
}

/**
 * Enough of a secret to tell two apart in a log line, and not enough to use.
 */
export function maskSecret(value: unknown): string {
  if (typeof value !== "string" || value === "") return "(empty)";
  // A one or two character value is entirely head, so a head-and-ellipsis
  // mask would print the whole thing. Nothing about it is worth showing.
  if (value.length <= 2) return "(too short to mask)";
  if (value.length <= 8) return `${value.slice(0, 2)}...`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/** The masked values of a stored credential, for a log line. */
export function describeStored(stored: StoredCredential): string {
  if (stored.state === "absent") return "(none)";
  if (stored.state === "unreadable") return "(unreadable)";
  return describeIncoming(stored.keys);
}

/**
 * The masked values a seeder is about to write.
 *
 * This takes the plaintext record, never an encrypted blob. Ciphertext masks
 * to a different string on every write because the IV is random, so an
 * operator could not compare it against the stored side, which is plaintext.
 */
export function describeIncoming(keys: Record<string, unknown>): string {
  const entries = Object.entries(keys);
  if (entries.length === 0) return "(none)";
  return entries
    .map(([name, value]) => `${name}=${maskSecret(value)}`)
    .join(" ");
}

/**
 * The line a seeder prints for every provider row it looked at. It names the
 * organization, the provider, the row, both credentials masked, and what the
 * seeder did. That is the line whose absence let a shared organization lose
 * its key to a stale one without anybody noticing.
 */
export function credentialWriteLog({
  tag,
  organizationId,
  provider,
  modelProviderId,
  stored,
  incoming,
  decision,
}: {
  tag: string;
  organizationId: string;
  provider: string;
  modelProviderId: string;
  stored: StoredCredential;
  incoming: Record<string, unknown>;
  decision: CredentialWriteDecision;
}): string {
  const verb = {
    write: "WRITING",
    keep: "KEEPING",
    skip: "SKIPPING",
  }[decision.action];
  return (
    `[${tag}] ${verb} credential on org=${organizationId} ` +
    `provider=${provider} row=${modelProviderId}: ` +
    `stored ${describeStored(stored)}, ` +
    `incoming ${describeIncoming(incoming)} ` +
    `(${decision.reason})\n`
  );
}

/**
 * The hint printed when a seeder leaves a credential in place, so the
 * operator knows the flag exists and what it costs.
 */
export function keepHint(tag: string): string {
  return (
    `[${tag}] pass --force-keys to replace it. The previous key is encrypted ` +
    `in the column and cannot be recovered afterwards.\n`
  );
}

/**
 * The warning printed when a row is skipped. The row keeps whatever it holds
 * and stays out of the seeded routing chain, so the operator has to decide.
 */
export function skipHint(
  tag: string,
  reason: Extract<CredentialWriteDecision, { action: "skip" }>["reason"],
): string {
  const cause =
    reason === "nothing to write"
      ? "The row holds no credential and this run has none to give it. Set the provider's environment variable, or enter the key through the UI."
      : "It was probably written under a different CREDENTIALS_SECRET. Re-enter the key through the UI, or pass --force-keys to overwrite it.";
  return `[${tag}] leaving the row out of the routing policy, and not enabling it. ${cause}\n`;
}
