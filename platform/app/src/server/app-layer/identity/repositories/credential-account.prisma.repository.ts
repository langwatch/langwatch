import { issuerForProviderId } from "@langwatch/identity-server/better-auth";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  belongsToSomebody,
  PasskeySignUpAddressTakenError,
} from "~/server/users/credential-user";
import type {
  CreatedCredentialUser,
  CredentialAccountRecordsPort,
  CredentialAccountRow,
  LinkedAccount,
  SecureAccountFacts,
  UnlinkAttempt,
} from "../credential-account.service";

/**
 * Every `Account`, `Passkey` and `User` row an account's own credentials are
 * made of (ADR-129).
 *
 * These queries were spread over the user router, the users module and the
 * sign-up verification runtime, each spelling the credential-row filter and
 * the case-insensitive address match for itself. They are one class now, and
 * `CredentialAccountService` is the only thing that asks them.
 *
 * `User`, `Account` and `Passkey` are identity tables under the multitenancy
 * middleware's exemption, so these queries carry no `projectId` — the models
 * have none, and a person is not scoped to a project.
 */
export class PrismaCredentialAccountRepository
  implements CredentialAccountRecordsPort
{
  constructor(private readonly prisma: PrismaClient) {}

  async findLinkedAccounts({
    userId,
  }: {
    userId: string;
  }): Promise<readonly LinkedAccount[]> {
    return await this.prisma.account.findMany({
      where: { userId },
      select: { id: true, provider: true, providerAccountId: true },
    });
  }

  async findCredentialAccount({
    userId,
  }: {
    userId: string;
  }): Promise<CredentialAccountRow | null> {
    const account = await this.prisma.account.findFirst({
      where: { userId, provider: "credential" },
      select: { id: true, password: true },
    });
    return account ? { id: account.id, passwordHash: account.password } : null;
  }

  async updateAccountPassword({
    accountId,
    passwordHash,
  }: {
    accountId: string;
    passwordHash: string;
  }): Promise<void> {
    await this.prisma.account.update({
      where: { id: accountId },
      data: { password: passwordHash },
    });
  }

  async createCredentialAccount({
    userId,
    passwordHash,
  }: {
    userId: string;
    passwordHash: string;
  }): Promise<void> {
    await this.prisma.account.create({
      data: {
        userId,
        type: "credential",
        provider: "credential",
        // better-auth 1.7 finds a credential account by
        // `(providerId, issuer, accountId)` and nothing else. A row written
        // without the issuer is a row its lookup cannot see, so the password
        // set here would never sign anybody in — the customer would be told
        // their correct password is wrong.
        issuer: issuerForProviderId("credential"),
        providerAccountId: userId,
        password: passwordHash,
      },
    });
  }

  /**
   * The Auth0 database connection (`auth0|<id>`), and only it. Social
   * identities linked through Auth0 (`google-oauth2|…`, `github|…`) are
   * managed by their upstream providers, and asking the Management API to
   * change one of their passwords fails.
   */
  async findFederatedPasswordAccountId({
    userId,
  }: {
    userId: string;
  }): Promise<string | null> {
    const account = await this.prisma.account.findFirst({
      where: {
        userId,
        provider: "auth0",
        providerAccountId: { startsWith: "auth0|" },
      },
      select: { providerAccountId: true },
    });
    return account?.providerAccountId ?? null;
  }

  /**
   * The count, the read and the delete in one SERIALIZABLE transaction.
   *
   * They were three unisolated statements, so two concurrent unlinks — a
   * double-clicked cross — could both observe two accounts, both pass the
   * last-account guard and both delete, leaving somebody with no way to sign
   * in. Serializable isolation is what stops the count being a stale snapshot
   * of a state a concurrent commit has already left.
   */
  async deleteLinkedAccount({
    userId,
    accountId,
  }: {
    userId: string;
    accountId: string;
  }): Promise<UnlinkAttempt> {
    return await this.prisma.$transaction(
      async (tx): Promise<UnlinkAttempt> => {
        const accounts = await tx.account.count({ where: { userId } });
        if (accounts <= 1) return "would_strand_user";

        const account = await tx.account.findFirst({
          where: { id: accountId, userId },
        });
        if (!account) return "no_such_account";

        await tx.account.delete({ where: { id: accountId } });
        return "deleted";
      },
      { isolationLevel: "Serializable" },
    );
  }

  async findSecureAccountFacts({
    userId,
  }: {
    userId: string;
  }): Promise<SecureAccountFacts> {
    const [passkeys, user] = await Promise.all([
      this.prisma.passkey.count({ where: { userId } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        // The column keeps its name. It has always dated one dismissal of one
        // offer, and it still does — the offer simply says more than it used
        // to. Renaming it would rewrite every existing dismissal's meaning.
        select: { passkeyNudgeDismissedAt: true, twoFactorEnabled: true },
      }),
    ]);
    return {
      passkeys,
      twoStepEnabled: user?.twoFactorEnabled ?? false,
      nudgeDismissedAt: user?.passkeyNudgeDismissedAt ?? null,
    };
  }

  /**
   * The `User` and its `credential` `Account`, in one transaction, because a
   * User written without one is a User with no way to sign in.
   */
  async createCredentialUser({
    name,
    email,
    passwordHash,
  }: {
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<CreatedCredentialUser> {
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name, email } });
      const account = await tx.account.create({
        data: {
          userId: user.id,
          type: "credential",
          provider: "credential",
          // better-auth 1.7 looks a credential row up by `(issuer,
          // accountId)`. A row written without the issuer is a row it cannot
          // see, so the account created here would be told its own password
          // is wrong.
          issuer: issuerForProviderId("credential"),
          providerAccountId: user.id,
          password: passwordHash,
        },
      });
      return { user, account };
    });

    return {
      id: created.user.id,
      accountId: created.account.id,
      accountCreatedAt: created.account.createdAt,
    };
  }

  /**
   * The account a passkey ceremony earned.
   *
   * The passkey row is written by the plugin, against the id this returns, so
   * there is no password to take and nothing here writes one. The
   * `credential` `Account` row is still created holding a NULL password, and
   * that is the whole point of it: password reset updates credential rows in
   * place, so an account with no such row cannot be recovered by resetting a
   * password — the update matches nothing and reports success, which is a
   * reset that silently does nothing and a person locked out with no error to
   * show for it. A row with a null password is refused by sign-in exactly as a
   * missing one is, and it gives recovery something to land on.
   *
   * ## Why this RESUMES rather than always creating
   *
   * Because the ceremony it serves cannot be made atomic, and pretending
   * otherwise is what stranded addresses. The passkey plugin calls
   * `resolveUser` before the browser prompt and `afterVerification` after it —
   * two requests, a round trip apart — and this runs inside the second. Its
   * own transaction commits independently of whatever happens next: if the
   * passkey write or the session mint then fails, the rows written here are
   * already durable and nothing can take them back.
   *
   * The recovery for a write that cannot be rolled back is one that can be
   * repeated. So a User row for this address with no usable credential is the
   * unfinished attempt, and it is ADOPTED — same row, same id, the placeholder
   * account left where it is — rather than colliding with the unique index on
   * the address and turning a resumable state into a permanent one.
   */
  async createPasskeyUser({
    email,
  }: {
    email: string;
  }): Promise<{ id: string; created: boolean }> {
    return await this.prisma.$transaction(async (tx) => {
      // Inside the transaction on purpose: the read and the write that depends
      // on it are one decision, and two concurrent ceremonies for the same
      // address must not both conclude the row is theirs to make. For the
      // CREATE branch the unique index on the address settles that race anyway
      // — the loser fails rather than writing a twin. For the ADOPT branch it
      // cannot, because adopting touches no unique column, which is why the
      // decision is re-taken below rather than inherited from the caller.
      //
      // Case-insensitive for the same reason registration's check is: rows
      // written before addresses were stored lowercased may carry capitals,
      // and a case-twin beside one is two Users answering for one person.
      const existing = await tx.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: {
          id: true,
          accounts: { select: { id: true, provider: true, password: true } },
          accountCredentials: { select: { provider: true, password: true } },
          passkeys: { select: { id: true }, take: 1 },
          orgMemberships: { select: { organizationId: true }, take: 1 },
        },
      });

      if (existing) {
        // Asked AGAIN, here, rather than trusted from the caller. The caller's
        // refusal ran before this transaction opened, and between the two an
        // account that was residue can become somebody's — a password set, a
        // passkey landed, an invitation redeemed. Deciding it inside the
        // transaction that adopts is what makes the read and the write one
        // decision instead of two; before, the unique index on the address was
        // the backstop for that race, and adopting rather than creating is
        // exactly what takes the index out of the path.
        if (belongsToSomebody(existing)) {
          throw new PasskeySignUpAddressTakenError(
            "the address gained a credential between the guard and the adoption",
          );
        }

        // All that can be missing is the placeholder itself, if the earlier
        // attempt died between its two writes.
        const hasPlaceholder = existing.accounts.some(
          (account) => account.provider === "credential",
        );
        if (!hasPlaceholder) {
          await tx.account.create({
            data: {
              userId: existing.id,
              type: "credential",
              provider: "credential",
              issuer: issuerForProviderId("credential"),
              providerAccountId: existing.id,
              password: null,
            },
          });
        }
        return { id: existing.id, created: false };
      }

      // The address stands in for the name nobody has asked for, as on the
      // password path: a blank name renders as nothing everywhere a member is
      // listed, and onboarding still offers to replace it.
      const user = await tx.user.create({ data: { name: email, email } });
      await tx.account.create({
        data: {
          userId: user.id,
          type: "credential",
          provider: "credential",
          issuer: issuerForProviderId("credential"),
          providerAccountId: user.id,
          password: null,
        },
      });
      return { id: user.id, created: true };
    });
  }
}
