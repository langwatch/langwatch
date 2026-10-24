import type { AuditLogApi } from "@langwatch/audit-log-contract";
import {
  accountLivenessKey,
  type BackfillDiff,
  backfillParityDiffs,
  IdentityCommandRefusedError,
  normalizeIdentifierValue,
  orphanedIdentifierRows,
} from "@langwatch/identity-contract";
import { type UserApi, UserNotFoundError } from "@langwatch/user-contract";

import type {
  BackfillAccountRow,
  BackfillUserRow,
  IdentityBackfillRepository,
} from "../repositories/identity-backfill.repository.ts";
import type { IdentityUsersRepository } from "../repositories/identity-users.repository.ts";
import {
  detachOrphanCommandId,
  establishUserEmailCommandId,
} from "../rules/identity-command-id.rules.ts";
import type { IdentityAdoptionWrites } from "../rules/identity-writes.rules.ts";
import { addressKeeperOrder, duplicateAddress } from "../rules/shared-address.rules.ts";
import { carriesPreProofSignInMethod, isUnprovenAccount } from "../rules/unproven-account.rules.ts";
import { mintUserHashKey } from "../rules/user-hash-key.rules.ts";
import {
  type IdentityBackfillPlanService,
  type PlannedIdentifier,
} from "./identity-backfill-plan.service.ts";
import type { IdentitySecretCarryService } from "./identity-secret-carry.service.ts";

const IDENTITY_BACKFILL_ACTOR = {
  type: "system" as const,
  id: "system:identity-backfill",
};

/** Reports stay bounded however far a projection has drifted. */
const MAX_REPORTED_DIFFS = 50;

/** How a pass settled an address another `User` shares; user ids only, never addresses. */
type SharedAddress =
  | { kind: "sole" }
  | { kind: "kept" | "yielded" | "retagged"; userIds: string[] };

export type IdentityBackfillOutcome =
  | { status: "finalized"; report: { kind: "user_missing" | "no_email" } }
  | {
      status: "finalized";
      report: {
        kind: "adopted";
        identifiers: number;
        sharedAddress?: Exclude<SharedAddress, { kind: "sole" }>;
      };
    }
  | { status: "migrated"; report: { kind: "parity"; diffs: BackfillDiff[] } }
  | { status: "migrated"; report: { kind: "unproven_account" } };

interface IdentityBackfillServiceDeps {
  now?: () => number;
}

/**
 * D01 — the identifier backfill for ONE user (ADR-101 §6): every sign-in
 */
export class IdentityBackfillService {
  static create({
    reads,
    users,
    identity,
    secrets,
    plan,
    userApi,
    auditLog,
    deps = {},
  }: {
    reads: IdentityBackfillRepository;
    users: IdentityUsersRepository;
    identity: IdentityAdoptionWrites;
    secrets: IdentitySecretCarryService;
    plan: IdentityBackfillPlanService;
    userApi: Pick<UserApi, "updateEmail">;
    auditLog: Pick<AuditLogApi, "record">;
    deps?: IdentityBackfillServiceDeps;
  }): IdentityBackfillService {
    return new IdentityBackfillService({
      reads,
      users,
      identity,
      secrets,
      plan,
      userApi,
      auditLog,
      deps,
    });
  }

  private readonly now: () => number;

  private readonly reads: IdentityBackfillRepository;
  private readonly users: IdentityUsersRepository;
  private readonly identity: IdentityAdoptionWrites;
  private readonly secrets: IdentitySecretCarryService;
  private readonly plan: IdentityBackfillPlanService;
  private readonly userApi: Pick<UserApi, "updateEmail">;
  private readonly auditLog: Pick<AuditLogApi, "record">;

  private constructor({
    reads,
    users,
    identity,
    secrets,
    plan,
    userApi,
    auditLog,
    deps,
  }: {
    reads: IdentityBackfillRepository;
    users: IdentityUsersRepository;
    identity: IdentityAdoptionWrites;
    secrets: IdentitySecretCarryService;
    plan: IdentityBackfillPlanService;
    userApi: Pick<UserApi, "updateEmail">;
    auditLog: Pick<AuditLogApi, "record">;
    deps: IdentityBackfillServiceDeps;
  }) {
    this.reads = reads;
    this.users = users;
    this.identity = identity;
    this.secrets = secrets;
    this.plan = plan;
    this.userApi = userApi;
    this.auditLog = auditLog;
    this.now = deps.now ?? Date.now;
  }

  async migrateUser({ userId }: { userId: string }): Promise<IdentityBackfillOutcome> {
    const user = await this.reads.getUser({ userId }).catch((error: unknown) => {
      if (UserNotFoundError.is(error)) return null;
      throw error;
    });
    if (!user) {
      // A vanished user has no history to adopt and no gate to open that
      // anything would consult; finalizing records that this pass looked.
      return { status: "finalized", report: { kind: "user_missing" } };
    }

    if (!user.email) {
      // Identifier values derive from the user's email; a user without one (erased, or an
      // import artifact) has no identifiers to backfill, so like a vanished user this is
      // terminal - `migrated` would be retried every pass forever with nothing to do.
      // Finalizing opens the write gate, which is right: any future ceremonies attach fresh
      // identifiers live, with no history left behind to adopt.
      return { status: "finalized", report: { kind: "no_email" } };
    }

    const accounts = await this.reads.findAccountRows({ userId });
    if (isUnprovenAccount(user) && (await this.carriesPreProofMethod({ user, accounts }))) {
      // Held on the legacy branch, where a confirmation link's adoption drops every pre-proof
      // credential; the pass writes nothing until the address is proven (Alex, 2026-10-06).
      // One carrying only its address has nothing to drop, so it finalizes unverified.
      return { status: "migrated", report: { kind: "unproven_account" } };
    }

    const shared = await this.settleSharedAddress({ user, email: user.email, accounts });
    const settled = shared.kind === "retagged" ? await this.reads.getUser({ userId }) : user;
    const email = settled.email ?? user.email;
    // A user yielding a shared address claims no lock: no account identifier (whose attach would
    // dead-end and drop its Account row) and an address that stays unverified (Alex, 2026-10-11).
    const yields = shared.kind === "yielded";

    if (settled.userHashKey === null) {
      await this.users.storeUserHashKeyIfMissing({
        userId,
        userHashKey: mintUserHashKey(),
      });
    }

    const planned = this.plan.planIdentifiers({
      user: { ...settled, email, emailVerified: settled.emailVerified && !yields },
      accounts: yields ? [] : accounts,
    });

    await this.adoptPlanned({ userId, email, planned });
    await this.establishEmail({
      userId,
      emailVerified: settled.emailVerified && !yields,
      createdAtMs: settled.createdAtMs,
      planned,
    });
    await this.detachOrphanedIdentifiers({ userId, accounts });
    await this.dropGoneCredentials({ userId, accounts });

    const outcome = await this.prove({ userId, planned });
    if (outcome.status === "finalized") {
      // The latch carries this user's secrets across ONCE (ADR-116 §4).
      await this.secrets.carryForUser({ userId });
    }

    return withSharedAddress({ outcome, shared });
  }

  /**
   * Two `User` rows on one address: whoever already holds its lock keeps it, else the most
   * recent sign-in (the older account when nobody signed in). When every one of them carries
   * only the address, each gets a plus-tagged duplicate instead (Alex, 2026-10-11).
   */
  private async settleSharedAddress({
    user,
    email,
    accounts,
  }: {
    user: BackfillUserRow;
    email: string;
    accounts: BackfillAccountRow[];
  }): Promise<SharedAddress> {
    const normalizedValue = normalizeIdentifierValue(email);
    const others = (await this.reads.findAddressSharers({ normalizedValue })).filter(
      (sharer) => sharer.id !== user.id,
    );
    if (others.length === 0) return { kind: "sole" };
    const userIds = others.map((other) => other.id);
    const group = [user, ...others];

    if (await this.everyoneCarriesOnlyTheAddress({ user, accounts, others })) {
      await this.retagSharedAddress({ group });
      return { kind: "retagged", userIds };
    }

    const holders = await this.reads.findAddressLockHolders({ normalizedValue });
    const holder = holders.find((id) => group.some((member) => member.id === id));
    const keeperId = holder ?? addressKeeperOrder(group)[0]?.id;
    return { kind: keeperId === user.id ? "kept" : "yielded", userIds };
  }

  private async everyoneCarriesOnlyTheAddress({
    user,
    accounts,
    others,
  }: {
    user: BackfillUserRow;
    accounts: BackfillAccountRow[];
    others: BackfillUserRow[];
  }): Promise<boolean> {
    if (await this.carriesPreProofMethod({ user, accounts })) return false;
    for (const other of others) {
      const theirs = await this.reads.findAccountRows({ userId: other.id });
      if (await this.carriesPreProofMethod({ user: other, accounts: theirs })) return false;
    }
    return true;
  }

  /** Each account in keeper order takes the next free `+duplicate-N`; the change is audited. */
  private async retagSharedAddress({ group }: { group: BackfillUserRow[] }): Promise<void> {
    let n = 1;
    for (const member of addressKeeperOrder(group)) {
      const from = member.email;
      if (from === null) continue;
      let address = duplicateAddress({ email: from, n });
      while (await this.addressIsTaken({ address })) {
        n += 1;
        address = duplicateAddress({ email: from, n });
      }
      await this.userApi.updateEmail({ id: member.id, email: address });
      await this.auditLog.record({
        userId: member.id,
        action: "user.email.duplicate_address_tagged",
        args: { from, to: address },
        targetKind: "user",
        targetId: member.id,
      });
      n += 1;
    }
  }

  private async addressIsTaken({ address }: { address: string }): Promise<boolean> {
    const sharers = await this.reads.findAddressSharers({
      normalizedValue: normalizeIdentifierValue(address),
    });
    return sharers.length > 0;
  }

  private async carriesPreProofMethod({
    user,
    accounts,
  }: {
    user: BackfillUserRow;
    accounts: BackfillAccountRow[];
  }): Promise<boolean> {
    return carriesPreProofSignInMethod({
      accounts: accounts.length,
      passkeys: await this.reads.countPasskeys({ userId: user.id }),
      passkeySignupPending: user.passkeySignupPending,
    });
  }

  private async adoptPlanned({
    userId,
    email,
    planned,
  }: {
    userId: string;
    email: string;
    planned: PlannedIdentifier[];
  }): Promise<void> {
    for (const plan of planned) {
      await this.identity.attachIdentifier({
        tenantId: userId,
        userId,
        commandId: plan.commandId,
        accountId: plan.accountId,
        provider: plan.provider,
        providerId: plan.providerId,
        issuer: plan.issuer,
        providerAccountId: plan.providerAccountId,
        value: email,
        occurredAtMs: plan.occurredAtMs,
        ceremony: { flow: "backfill" },
        actor: IDENTITY_BACKFILL_ACTOR,
      });
    }
  }

  /**
   * The email identifier's establishment: a verified User.email means the mailbox ceremony (or
   * an equivalent) already happened — recorded with method "creation", no Verification record
   * to cite.
   */
  private async establishEmail({
    userId,
    emailVerified,
    createdAtMs,
    planned,
  }: {
    userId: string;
    emailVerified: boolean;
    createdAtMs: number;
    planned: PlannedIdentifier[];
  }): Promise<void> {
    const emailPlan = planned.find((plan) => plan.provider === "email");
    if (!emailPlan || !emailVerified) {
      return;
    }

    await tolerateRefusal(() =>
      this.identity.verifyIdentifier({
        tenantId: userId,
        userId,
        commandId: establishUserEmailCommandId({ userId }),
        identifierId: emailPlan.identifierId,
        verificationId: null,
        method: "creation",
        occurredAtMs: createdAtMs,
        actor: IDENTITY_BACKFILL_ACTOR,
      }),
    );
  }

  /**
   * The compensating fact: an identifier this pass adopted from an `Account` row that no longer
   * exists is detached, so the projection never outlives the legacy truth it was proven
   * against.
   */
  private async detachOrphanedIdentifiers({
    userId,
    accounts,
  }: {
    userId: string;
    accounts: BackfillAccountRow[];
  }): Promise<void> {
    const rows = await this.reads.findIdentifierRows({ userId });
    const orphaned = orphanedIdentifierRows({
      rows,
      liveAccountIds: new Set(accounts.map((account) => account.id)),
    });
    for (const row of orphaned) {
      await tolerateRefusal(() =>
        this.identity.detachIdentifier({
          tenantId: userId,
          userId,
          commandId: detachOrphanCommandId({
            identifierId: row.id,
            // `orphanedIdentifierRows` only ever returns rows carrying an
            // accountId - an identifier without one is never the backfill's
            // to detach.
            accountId: row.accountId as string,
          }),
          identifierId: row.id,
          occurredAtMs: this.now(),
          actor: IDENTITY_BACKFILL_ACTOR,
        }),
      );
    }
  }

  /**
   * Level-triggered: every identifier whose `Account` row is gone, detached or not, names a
   * carried credential row with no sign-in method behind it any more.
   */
  private async dropGoneCredentials({
    userId,
    accounts,
  }: {
    userId: string;
    accounts: BackfillAccountRow[];
  }): Promise<void> {
    const liveAccountIds = new Set(accounts.map((account) => account.id));
    const rows = await this.reads.findIdentifierRows({ userId });
    const goneAccountIds = new Set<string>();
    for (const row of rows) {
      if (row.accountId === null) continue;
      // A credential row carries its `Account` row's id, which is the liveness key.
      const accountId = accountLivenessKey(row.accountId);
      if (!liveAccountIds.has(accountId)) goneAccountIds.add(accountId);
    }
    await this.secrets.dropCredentials({ userId, accountIds: [...goneAccountIds] });
  }

  /**
   * The exit gate: the fold-built rows against the plan, both directions.
   */
  private async prove({
    userId,
    planned,
  }: {
    userId: string;
    planned: PlannedIdentifier[];
  }): Promise<IdentityBackfillOutcome> {
    const rows = await this.reads.findIdentifierRows({ userId });
    const diffs = backfillParityDiffs({ rows, expected: planned });
    if (diffs.length > 0) {
      return {
        status: "migrated",
        report: { kind: "parity", diffs: diffs.slice(0, MAX_REPORTED_DIFFS) },
      };
    }

    return {
      status: "finalized",
      report: { kind: "adopted", identifiers: planned.length },
    };
  }
}

/** A finalized adoption names how a shared address settled; every other outcome is as proven. */
function withSharedAddress({
  outcome,
  shared,
}: {
  outcome: IdentityBackfillOutcome;
  shared: SharedAddress;
}): IdentityBackfillOutcome {
  if (shared.kind === "sole" || outcome.status !== "finalized") return outcome;
  if (outcome.report.kind !== "adopted") return outcome;
  return { status: "finalized", report: { ...outcome.report, sharedAddress: shared } };
}

/** A command the guards refused is a parity fact, never a park. */
async function tolerateRefusal(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof IdentityCommandRefusedError)) {
      throw error;
    }
  }
}
