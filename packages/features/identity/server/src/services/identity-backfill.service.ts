import {
  type BackfillDiff,
  backfillParityDiffs,
  IdentityCommandRefusedError,
  orphanedIdentifierRows,
} from "@langwatch/identity-contract";
import { mintUserHashKey } from "../rules/user-hash-key.rules";
import {
  IdentityBackfillPlanService,
  type PlannedIdentifier,
} from "./identity-backfill-plan.service";
import type {
  BackfillAccountRow,
  IdentityBackfillRepository,
} from "../repositories/identity-backfill.repository";
import {
  detachOrphanCommandId,
  establishUserEmailCommandId,
} from "../rules/identity-command-id.rules";
import type { IdentitySecretCarryService } from "./identity-secret-carry.service";
import type { IdentityUsersRepository } from "../repositories/identity-users.repository";
import type { IdentityAdoptionWrites } from "../rules/identity-writes.rules";

export const IDENTITY_BACKFILL_ACTOR = {
  type: "system" as const,
  id: "system:identity-backfill",
};

/** Reports stay bounded however far a projection has drifted. */
const MAX_REPORTED_DIFFS = 50;

export type IdentityBackfillOutcome =
  | { status: "finalized"; report: { kind: "user_missing" | "no_email" } }
  | { status: "finalized"; report: { kind: "adopted"; identifiers: number } }
  | { status: "migrated"; report: { kind: "parity"; diffs: BackfillDiff[] } };

export interface IdentityBackfillServiceDeps {
  now?: () => number;
}

/**
 * D01 — the identifier backfill for ONE user (ADR-101 §6): every sign-in
 */
export class IdentityBackfillService {
  static create(
    reads: IdentityBackfillRepository,
    users: IdentityUsersRepository,
    identity: IdentityAdoptionWrites,
    secrets: IdentitySecretCarryService,
    plan: IdentityBackfillPlanService,
    deps: IdentityBackfillServiceDeps = {},
  ): IdentityBackfillService {
    return new IdentityBackfillService(reads, users, identity, secrets, plan, deps);
  }

  private readonly now: () => number;

  private constructor(
    private readonly reads: IdentityBackfillRepository,
    private readonly users: IdentityUsersRepository,
    private readonly identity: IdentityAdoptionWrites,
    private readonly secrets: IdentitySecretCarryService,
    private readonly plan: IdentityBackfillPlanService,
    deps: IdentityBackfillServiceDeps = {},
  ) {
    this.now = deps.now ?? Date.now;
  }

  async migrateUser({ userId }: { userId: string }): Promise<IdentityBackfillOutcome> {
    const user = await this.reads.tryFindUser({ userId });
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

    if (user.userHashKey === null) {
      await this.users.storeUserHashKeyIfMissing({
        userId,
        userHashKey: mintUserHashKey(),
      });
    }

    const accounts = await this.reads.findAccountRows({ userId });
    const planned = this.plan.planIdentifiers({
      user: { ...user, email: user.email },
      accounts,
    });

    await this.adoptPlanned({ userId, email: user.email, planned });
    await this.establishEmail({
      userId,
      emailVerified: user.emailVerified,
      createdAtMs: user.createdAtMs,
      planned,
    });
    await this.detachOrphanedIdentifiers({ userId, accounts });

    const outcome = await this.prove({ userId, planned });
    if (outcome.status === "finalized") {
      // The latch carries this user's secrets across ONCE (ADR-116 §4).
      await this.secrets.carryForUser({ userId });
    }

    return outcome;
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
