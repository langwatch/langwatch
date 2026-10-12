/** One `User` row whose address normalises to the same value as another's. */
export interface AddressSharer {
  id: string;
  lastLoginAtMs: number | null;
  createdAtMs: number;
}

/**
 * Who keeps a shared address first: the most recent sign-in, else the oldest account, then the
 * id so every pass orders the same (Alex, 2026-10-11).
 */
export function addressKeeperOrder<T extends AddressSharer>(sharers: readonly T[]): T[] {
  return sharers.toSorted(
    (left, right) =>
      (right.lastLoginAtMs ?? -1) - (left.lastLoginAtMs ?? -1) ||
      left.createdAtMs - right.createdAtMs ||
      left.id.localeCompare(right.id),
  );
}

/**
 * `local+duplicate-N@domain`, or `local+tag-duplicate-N@domain` when the address already
 * carries a tag: the same mailbox at most providers, and plain to support.
 */
export function duplicateAddress({ email, n }: { email: string; n: number }): string {
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const tagged = local.includes("+") ? `${local}-duplicate-${n}` : `${local}+duplicate-${n}`;
  return `${tagged}@${domain}`;
}
