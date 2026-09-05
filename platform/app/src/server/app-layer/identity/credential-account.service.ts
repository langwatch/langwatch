import { IdentityDetachStrandsUserError } from "@langwatch/identity";
import { EmailAlreadyRegisteredError } from "~/server/users/errors";

/** One linked sign-in method, as the account settings screen lists it. */
export interface LinkedAccount {
  id: string;
  provider: string;
  providerAccountId: string;
}

/**
 * The `credential` row, as password management reads it: the row's own id,
 * because writing the password is keyed on it, and the hash, because whether
 * there IS one decides between setting a first password and changing one.
 */
export interface CredentialAccountRow {
  id: string;
  passwordHash: string | null;
}

/**
 * The rows a credential sign-up wrote, as the identifier attach needs them.
 *
 * The account's own id and `createdAt` ride out rather than being re-read,
 * because the identifier stated next must derive from THIS row: the backfill
 * links by `Account.id` and takes `occurredAt` from `Account.createdAt`, so
 * anything else produces a second projection row for one credential instead of
 * converging on one.
 */
export interface CreatedCredentialUser {
  id: string;
  accountId: string;
  accountCreatedAt: Date;
}

/** What the "secure your account" offer reads about somebody (ADR-120, D06). */
export interface SecureAccountFacts {
  /** How many passkeys they hold; the offer is about holding none. */
  passkeys: number;
  twoStepEnabled: boolean;
  /** When they last said "not now", or null if they never have. */
  nudgeDismissedAt: Date | null;
}

/** What the store made of an unlink, decided inside its own transaction. */
export type UnlinkAttempt = "deleted" | "no_such_account" | "would_strand_user";

/** What the caller has to answer for: the strand is refused, not returned. */
export type UnlinkResult = Exclude<UnlinkAttempt, "would_strand_user">;

/** What became of setting a FIRST password. */
export type SetPasswordResult = "set" | "already_has_password";

/** What became of changing a password held here. */
export type ChangePasswordResult =
  | "changed"
  | "no_password_set"
  | "wrong_password";

/** What became of changing a password the identity provider holds. */
export type FederatedPasswordResult =
  | "changed"
  | "no_federated_account"
  | "no_address_on_record"
  | "wrong_password";

/**
 * Every `Account`, `Passkey` and `User` row credential management reads or
 * writes. The service asks; this port is the only thing that knows a database
 * is involved.
 */
export interface CredentialAccountRecordsPort {
  findLinkedAccounts(args: {
    userId: string;
  }): Promise<readonly LinkedAccount[]>;
  /** The `credential` row, or null for an account that has never had one. */
  findCredentialAccount(args: {
    userId: string;
  }): Promise<CredentialAccountRow | null>;
  updateAccountPassword(args: {
    accountId: string;
    passwordHash: string;
  }): Promise<void>;
  /** Writes the `credential` row an older account was never given. */
  createCredentialAccount(args: {
    userId: string;
    passwordHash: string;
  }): Promise<void>;
  /**
   * The identity provider's own database connection, which is the only
   * federated row whose password can be changed from here.
   */
  findFederatedPasswordAccountId(args: {
    userId: string;
  }): Promise<string | null>;
  /**
   * Removes one linked account, deciding INSIDE its own transaction whether
   * doing so would leave the person with no way in.
   */
  deleteLinkedAccount(args: {
    userId: string;
    accountId: string;
  }): Promise<UnlinkAttempt>;
  findSecureAccountFacts(args: { userId: string }): Promise<SecureAccountFacts>;
  /** The `User` and its `credential` `Account`, written in one transaction. */
  createCredentialUser(args: {
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<CreatedCredentialUser>;
  /**
   * The account a passkey ceremony earned — created, or the unfinished
   * attempt for this address resumed.
   */
  createPasskeyUser(args: {
    email: string;
  }): Promise<{ id: string; created: boolean }>;
}

/**
 * Who already holds an address. One method, because registration asks exactly
 * one question of the directory and the case-insensitive comparison behind it
 * belongs to the repository that owns it.
 */
export interface CredentialAddressDirectoryPort {
  findUserIdByEmail(args: { normalizedValue: string }): Promise<string | null>;
}

/**
 * Hashing a password and checking one against a hash. A port so the service
 * states WHEN a password is hashed while bcrypt's cost stays a composition
 * decision — and so a test of these rules is not a test of bcrypt's speed.
 */
export interface PasswordHasherPort {
  hash(args: { password: string }): Promise<string>;
  matches(args: { password: string; hash: string }): Promise<boolean>;
}

/**
 * The identity provider's own password change, for a deployment where the
 * credential lives in its tenant rather than in our rows.
 */
export interface FederatedPasswordPort {
  changePassword(args: {
    email: string;
    federatedUserId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ ok: boolean }>;
}

/**
 * The credential identifier a new account owes the front door (ADR-117 §6).
 *
 * The door routes on the identifier projection, so an account is reachable
 * only once its credential is a stated fact — and the two account-creating
 * paths here write through Prisma rather than through better-auth's storage
 * adapter, so no ceremony states it for them.
 */
export interface CredentialIdentifiersPort {
  attachCredentialIdentifier(args: {
    userId: string;
    email: string;
    accountId: string;
    occurredAtMs: number;
  }): Promise<void>;
}

/** Ending the sessions a newly written password must outlive. */
export interface OtherSessionsPort {
  revokeOthers(args: { userId: string; keepSessionId: string }): Promise<void>;
}

/** The one analytics milestone a sign-up owes. */
export interface SignUpMilestonesPort {
  signedUp(args: { userId: string }): void;
}

export interface CredentialAccountServiceDeps {
  records: CredentialAccountRecordsPort;
  directory: CredentialAddressDirectoryPort;
  passwords: PasswordHasherPort;
  federated: FederatedPasswordPort;
  identifiers: CredentialIdentifiersPort;
  sessions: OtherSessionsPort;
  milestones: SignUpMilestonesPort;
}

/**
 * Everything an account's own credentials are: creating one with a password or
 * a passkey, listing and unlinking the ways in, and setting, changing or
 * simply having a password.
 *
 * WHY THESE BELONG TOGETHER. They are the writers of `Account` rows outside
 * the storage adapter and the ceremonies, and they were spread over the user
 * router, the users module and the sign-up verification runtime — three places
 * that each hashed a password, each decided for themselves what "has a
 * password" means, and each spelled the address lookup their own way. ADR-129
 * makes them one service so the rules are stated once: a password is hashed
 * where it is written, an account is never left with no way in, and a password
 * that appears ends every session that did not just prove it.
 *
 * Nothing here touches a client. Rows come from
 * `PrismaCredentialAccountRepository`, the address lookup from the identity
 * users repository, bcrypt from the hasher port and the identity provider's
 * own credential store from the federated port — so every rule below is
 * exercised by a unit test with no datastore in sight.
 *
 * The refusals a caller cannot act on are not raised here. `unlinkAccount`
 * throwing {@link IdentityDetachStrandsUserError} and `register` throwing
 * {@link EmailAlreadyRegisteredError} are handled errors with copy of their
 * own; everything else is answered as an outcome the boundary turns into the
 * response its transport speaks.
 */
export class CredentialAccountService {
  constructor(private readonly deps: CredentialAccountServiceDeps) {}

  /**
   * Creates the account somebody typed an address and a password into.
   *
   * The duplicate check is case-insensitive, through the repository that owns
   * that comparison: rows written before addresses were stored lowercased may
   * carry capitals, and minting a case-twin beside one leaves two Users
   * answering for one human.
   *
   * The password is hashed HERE rather than by the caller, which is what keeps
   * a plaintext password out of every layer below this line.
   */
  async register({
    name,
    email,
    password,
  }: {
    /** Null where nobody has been asked for one; onboarding asks later. */
    name: string | null;
    email: string;
    password: string;
  }): Promise<{ id: string }> {
    const held = await this.deps.directory.findUserIdByEmail({
      normalizedValue: email,
    });
    if (held) throw new EmailAlreadyRegisteredError();

    return await this.openCredentialAccount({
      name,
      email,
      passwordHash: await this.deps.passwords.hash({ password }),
    });
  }

  /**
   * Opens an account whose credential is a password, from a hash.
   *
   * One writer for both doors into it: the sign-up form above, and a verified
   * sign-up that started as a log-in for an address nobody held (D13). They
   * must write the same rows and state the same identifier, or one of them
   * produces a User the front door says does not exist.
   *
   * It takes a HASH rather than a password because the log-in door hashes at
   * the moment the credential is taken and keeps only the hash until the
   * address is verified, so there is never a plaintext password at rest.
   */
  async openCredentialAccount({
    name,
    email,
    passwordHash,
  }: {
    name: string | null;
    email: string;
    passwordHash: string;
  }): Promise<{ id: string }> {
    const created = await this.deps.records.createCredentialUser({
      // The address stands in for a name nobody has been asked for yet. A
      // blank name is what every member list, invitation and audit line
      // rendered for a fresh account, and an address is at least who they are;
      // onboarding still offers to replace it.
      name: name ?? email,
      email,
      passwordHash,
    });

    await this.deps.identifiers.attachCredentialIdentifier({
      userId: created.id,
      email,
      accountId: created.accountId,
      occurredAtMs: created.accountCreatedAt.getTime(),
    });

    // Email-mode sign-ups bypass better-auth's user-create hooks, so the
    // milestone is stated here rather than by a ceremony that never runs.
    this.deps.milestones.signedUp({ userId: created.id });

    return { id: created.id };
  }

  /**
   * Opens — or resumes — the account a passkey ceremony earned.
   *
   * `created` is false where an unfinished earlier attempt was adopted, and
   * the milestone follows it: somebody who needed two attempts is one sign-up,
   * not two.
   */
  async openPasskeyAccount({
    email,
  }: {
    email: string;
  }): Promise<{ id: string; created: boolean }> {
    const outcome = await this.deps.records.createPasskeyUser({ email });
    if (outcome.created) {
      this.deps.milestones.signedUp({ userId: outcome.id });
    }
    return outcome;
  }

  /** Every way in this person has linked, for the settings screen. */
  async linkedAccounts({
    userId,
  }: {
    userId: string;
  }): Promise<readonly LinkedAccount[]> {
    return await this.deps.records.findLinkedAccounts({ userId });
  }

  /**
   * Removes one linked account, and refuses to remove the last one.
   *
   * The count and the delete are ONE decision under serializable isolation,
   * which is why the store decides it rather than this method reading a count
   * and then asking for a delete: two concurrent unlinks — a double-clicked
   * cross — both saw two accounts, both passed the guard, and both deleted,
   * leaving somebody with no way to sign in.
   *
   * The refusal is the same one the detach guard raises, so the words the
   * caller reads come from the code-keyed presentation registry rather than
   * from a sentence written here.
   */
  async unlinkAccount({
    userId,
    accountId,
  }: {
    userId: string;
    accountId: string;
  }): Promise<UnlinkResult> {
    const attempt = await this.deps.records.deleteLinkedAccount({
      userId,
      accountId,
    });
    if (attempt === "would_strand_user") {
      throw new IdentityDetachStrandsUserError(
        `unlink_account: ${accountId} is the last account of user ${userId}`,
      );
    }
    return attempt;
  }

  /**
   * Whether this person can sign in with a password.
   *
   * A `credential` row holding no password is not one: it is what a passkey
   * sign-up writes so that recovery has something to land on, and sign-in
   * refuses it exactly as it refuses a missing row.
   */
  async hasPassword({ userId }: { userId: string }): Promise<boolean> {
    const account = await this.deps.records.findCredentialAccount({ userId });
    return Boolean(account?.passwordHash);
  }

  /**
   * Sets a FIRST password, for an account that has none.
   *
   * It can only ever FILL AN EMPTY SLOT. Where a password already exists this
   * answers `already_has_password` and changing it is the way, which is what
   * keeps this from becoming a no-proof overwrite of somebody's credential: a
   * stolen session can already read everything, and the thing worth denying it
   * is a credential that outlives the session being revoked.
   *
   * Where the account has no `credential` row at all — an account that
   * predates the row being written up front, an SSO-only user — one is
   * created, because that row is what password reset updates in place and
   * recovery cannot work until it exists.
   */
  async setFirstPassword({
    userId,
    password,
    keepSessionId,
  }: {
    userId: string;
    password: string;
    /** The session to spare; null ends nothing. See {@link revokeOtherSessions}. */
    keepSessionId: string | null;
  }): Promise<SetPasswordResult> {
    const account = await this.deps.records.findCredentialAccount({ userId });
    if (account?.passwordHash) return "already_has_password";

    const passwordHash = await this.deps.passwords.hash({ password });
    if (account) {
      await this.deps.records.updateAccountPassword({
        accountId: account.id,
        passwordHash,
      });
    } else {
      await this.deps.records.createCredentialAccount({ userId, passwordHash });
    }

    await this.revokeOtherSessions({ userId, keepSessionId });
    return "set";
  }

  /**
   * Changes a password held in our own rows, on proof of the current one.
   *
   * The proof is what makes this safe under a stolen session: an attacker
   * holding a valid cookie still cannot rotate the credential without knowing
   * what it is.
   */
  async changePassword({
    userId,
    currentPassword,
    newPassword,
    keepSessionId,
  }: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    keepSessionId: string | null;
  }): Promise<ChangePasswordResult> {
    const account = await this.deps.records.findCredentialAccount({ userId });
    if (!account?.passwordHash) return "no_password_set";

    const proven = await this.deps.passwords.matches({
      password: currentPassword,
      hash: account.passwordHash,
    });
    if (!proven) return "wrong_password";

    await this.deps.records.updateAccountPassword({
      accountId: account.id,
      passwordHash: await this.deps.passwords.hash({ password: newPassword }),
    });

    await this.revokeOtherSessions({ userId, keepSessionId });
    return "changed";
  }

  /**
   * Changes a password the identity provider holds, on proof of the current
   * one.
   *
   * Only its own database connection has a password we can update; social
   * identities linked through it are managed by their upstream providers, and
   * this answers `no_federated_account` rather than asking the provider to
   * change a password it does not hold.
   *
   * The sessions still end here. The provider's own sessions are its business,
   * but the LangWatch session is a row of ours that its password change does
   * not touch — so without this a stolen session token would outlive the
   * rotation that was meant to close it.
   */
  async changeFederatedPassword({
    userId,
    email,
    currentPassword,
    newPassword,
    keepSessionId,
  }: {
    userId: string;
    /** Null where the session carries no address to prove the password with. */
    email: string | null;
    currentPassword: string;
    newPassword: string;
    keepSessionId: string | null;
  }): Promise<FederatedPasswordResult> {
    const federatedUserId =
      await this.deps.records.findFederatedPasswordAccountId({ userId });
    if (!federatedUserId) return "no_federated_account";
    if (!email) return "no_address_on_record";

    const result = await this.deps.federated.changePassword({
      email,
      federatedUserId,
      currentPassword,
      newPassword,
    });
    if (!result.ok) return "wrong_password";

    await this.revokeOtherSessions({ userId, keepSessionId });
    return "changed";
  }

  /** What the "secure your account" offer is decided from (ADR-120, D06). */
  async secureAccountFacts({
    userId,
  }: {
    userId: string;
  }): Promise<SecureAccountFacts> {
    return await this.deps.records.findSecureAccountFacts({ userId });
  }

  /**
   * Ends every session but the one that just proved itself.
   *
   * A password is a credential that outlives session revocation, so anything
   * else holding a session at the moment one appears or changes must not keep
   * it. The tab that did the proving stays signed in.
   *
   * A null `keepSessionId` ends NOTHING rather than everything, and the
   * distinction is the impersonation safeguard: the session id an operator's
   * request carries is the operator's own, so "revoke every other session of
   * the subject" would end the subject's sessions and leave the operator's —
   * the opposite of what the caller means.
   */
  private async revokeOtherSessions({
    userId,
    keepSessionId,
  }: {
    userId: string;
    keepSessionId: string | null;
  }): Promise<void> {
    if (!keepSessionId) return;
    await this.deps.sessions.revokeOthers({ userId, keepSessionId });
  }
}
