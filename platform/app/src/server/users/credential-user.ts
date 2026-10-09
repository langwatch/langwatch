/**
 * What counts as a credential, for the two guards that have to agree about it.
 *
 * Framework-free and store-free on purpose: the rows these read are written by
 * `PrismaCredentialAccountRepository` and the decisions taken over them belong
 * to `CredentialAccountService` (ADR-129), while the passkey sign-up plugin
 * asks the same questions of rows it read itself. One definition, imported by
 * both sides, is what keeps them from drifting into disagreeing about the same
 * account.
 */

/**
 * A passkey sign-up that arrived for an address somebody already holds.
 *
 * Its own class because the caller has to tell it apart from every other way
 * this can fail: it is the one that means "refuse in the taken-address
 * vocabulary", and a message match would be the alternative.
 */
export class PasskeySignUpAddressTakenError extends Error {
  readonly name = "PasskeySignUpAddressTakenError";
}

/**
 * A credential row somebody could actually present.
 *
 * `provider` decides it rather than `password`: a row for an identity
 * provider carries no password by design and is still a way in, while a
 * `credential` row with no password is the one shape that is not — it is what
 * `createPasskeyUser` writes before the passkey lands beside it, and on its
 * own it authenticates nobody (sign-in hashes a dummy and refuses it exactly
 * as it refuses a missing row).
 *
 * Empty counts as absent, in the same words `last-way-in.ts` uses. The two
 * guards answer one question from opposite sides — that one refuses removing
 * the last way in, this one refuses adopting an account that still has one —
 * so a row either calls a credential the other must too.
 */
export function isUsableCredential(row: {
  provider: string;
  password: string | null;
}): boolean {
  if (row.provider !== "credential") return true;
  return typeof row.password === "string" && row.password.length > 0;
}

/**
 * Whether this account is somebody's, rather than the residue of a ceremony
 * that never finished.
 *
 * ONE definition, exported, because two collaborators decide the same thing
 * about the same row at two moments: the sign-up guard refuses before the
 * browser prompt opens, and the adoption re-decides it inside the transaction
 * that writes. Two copies of this would be two chances to disagree, and the
 * disagreement would be a takeover on one side or a burnt address on the
 * other.
 *
 * Both credential tables are read: a user whose identifier backfill has
 * finalized keeps theirs in `AccountCredential` rather than `Account`, and a
 * check seeing only one would call every finalized user unregistered.
 * Membership counts on its own — an account that belongs to an organization
 * is somebody's whatever its credential rows say.
 */
export function belongsToSomebody(row: {
  accounts: { provider: string; password: string | null }[];
  accountCredentials: { provider: string; password: string | null }[];
  passkeys: unknown[];
  orgMemberships: unknown[];
}): boolean {
  return (
    row.passkeys.length > 0 ||
    row.orgMemberships.length > 0 ||
    row.accounts.some(isUsableCredential) ||
    row.accountCredentials.some(isUsableCredential)
  );
}
