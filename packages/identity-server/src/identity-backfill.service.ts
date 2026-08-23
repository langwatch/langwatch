import {
  arrivalStateForProvider,
  type BackfillDiff,
  backfillParityDiffs,
  type ExpectedIdentifier,
  IdentityCommandRefusedError,
  identifierProviderFor,
  normalizeIdentifierValue,
  orphanedIdentifierRows,
} from "@langwatch/identity";
import { deriveIdentifierId } from "./crypto/identifier-identity";
import { mintUserHashKey } from "./crypto/user-hash-key";
import type {
  BackfillAccountRow,
  BackfillUserRow,
  IdentityBackfillRepository,
} from "./identity-backfill.repository";
import type { IdentityUsersRepository } from "./identity-users.repository";
import type { IdentityService } from "./identity.service";

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

/** An identifier the backfill adopts, with the command that attaches it. */
type Adoption = ExpectedIdentifier & {
  commandId: string;
  accountId: string | null;
  providerAccountId: string | null;
  occurredAtMs: number;
};

export interface IdentityBackfillServiceDeps {
  now?: () => number;
}

/**
 * D01 — the identifier backfill for ONE user (ADR-101 §6): every sign-in
 * method the user already holds becomes identity history, the grants
 * genesis-import discipline re-tenanted to users. The app's `SystemMigration`
 * adapter drives this per tenant; the runner's contract stays the app's.
 *
 * Adoption, not re-creation: command ids derive from the source rows
 * (`backfill:<accountId>`, `backfill:user-email:<userId>`), business time is
 * each row's own `createdAt`, and the deterministic identifier ids derive
 * from both — so a re-run states the same facts and live emission of the
 * same fact converges on the same projection row.
 *
 * A pass states only what the heads do not carry (PR #7429): every guard
 * reads the projection first and emits nothing for a fact already folded,
 * so a pass after the first writes no event_log row for a user whose
 * history has not changed. Nothing here consults a previous record; there
 * is no partial state a failed pass could leave behind that the next full
 * pass does not simply redo.
 *
 * Self-proving: `finalized` only when the fold-built `Identifier` rows match
 * what the live `Account`/`User` rows imply, in both directions
 * (`backfillParityDiffs`). A disagreement holds the user at `migrated` with
 * a bounded diff report, and a later pass retries the proof. Finalization is
 * the LATCH the adapter's per-user write gate reads.
 *
 * One disagreement is named rather than repaired, deliberately: an account
 * removed and re-linked between passes re-derives the id of the detached
 * identifier, its restated attach emits nothing against the head that
 * already carries it, so the head stays DETACHED and the check reports
 * `state_mismatch` each pass (toward LESS sign-in history, never more).
 * Remediation is the operator's.
 */
export class IdentityBackfillService {
  private readonly now: () => number;

  constructor(
    private readonly reads: IdentityBackfillRepository,
    private readonly users: IdentityUsersRepository,
    private readonly identity: Pick<
      IdentityService,
      "attachIdentifier" | "verifyIdentifier" | "detachIdentifier"
    >,
    deps: IdentityBackfillServiceDeps = {},
  ) {
    this.now = deps.now ?? Date.now;
  }

  async migrateUser({
    userId,
  }: {
    userId: string;
  }): Promise<IdentityBackfillOutcome> {
    const user = await this.reads.findUser({ userId });
    if (!user) {
      // A vanished user has no history to adopt and no gate to open that
      // anything would consult; finalizing records that this pass looked.
      return { status: "finalized", report: { kind: "user_missing" } };
    }
    if (!user.email) {
      // Identifier values derive from the user's email; a user without one
      // (erased, or an import artifact) has no identifiers to backfill, so
      // like a vanished user this is terminal - `migrated` would be retried
      // every pass forever with nothing to do. Finalizing opens the write
      // gate, which is right: any future ceremonies attach fresh identifiers
      // live, with no history left behind to adopt.
      return { status: "finalized", report: { kind: "no_email" } };
    }
    if (user.userHashKey === null) {
      await this.users.storeUserHashKeyIfMissing({
        userId,
        userHashKey: mintUserHashKey(),
      });
    }

    const accounts = await this.reads.findAccountRows({ userId });
    const expected = expectedIdentifiers({
      user: { ...user, email: user.email },
      accounts,
    });

    await this.adoptExpected({ userId, email: user.email, expected });
    await this.establishEmail({
      userId,
      emailVerified: user.emailVerified,
      createdAtMs: user.createdAtMs,
      expected,
    });
    await this.detachOrphanedIdentifiers({ userId, accounts });

    const rows = await this.reads.findIdentifierRows({ userId });
    const diffs = backfillParityDiffs({ rows, expected });
    if (diffs.length > 0) {
      return {
        status: "migrated",
        report: { kind: "parity", diffs: diffs.slice(0, MAX_REPORTED_DIFFS) },
      };
    }
    return {
      status: "finalized",
      report: { kind: "adopted", identifiers: expected.length },
    };
  }

  private async adoptExpected({
    userId,
    email,
    expected,
  }: {
    userId: string;
    email: string;
    expected: Adoption[];
  }): Promise<void> {
    for (const adoption of expected) {
      await this.identity.attachIdentifier({
        tenantId: userId,
        userId,
        commandId: adoption.commandId,
        accountId: adoption.accountId,
        provider: adoption.provider,
        providerAccountId: adoption.providerAccountId,
        value: email,
        occurredAtMs: adoption.occurredAtMs,
        ceremony: { flow: "backfill" },
        actor: IDENTITY_BACKFILL_ACTOR,
      });
    }
  }

  /**
   * The email identifier's establishment: a verified User.email means the
   * mailbox ceremony (or an equivalent) already happened — recorded with
   * method "creation", no Verification record to cite. A refusal here is
   * a parity fact (the identifier dead-ended or detached), never a park:
   * the parity check reports it and the user is held.
   */
  private async establishEmail({
    userId,
    emailVerified,
    createdAtMs,
    expected,
  }: {
    userId: string;
    emailVerified: boolean;
    createdAtMs: number;
    expected: ExpectedIdentifier[];
  }): Promise<void> {
    const emailExpectation = expected.find(
      (candidate) => candidate.provider === "email",
    );
    if (!emailExpectation || !emailVerified) return;
    await tolerateRefusal(() =>
      this.identity.verifyIdentifier({
        tenantId: userId,
        userId,
        commandId: `backfill:verify-email:${userId}`,
        identifierId: emailExpectation.identifierId,
        verificationId: null,
        method: "creation",
        occurredAtMs: createdAtMs,
        actor: IDENTITY_BACKFILL_ACTOR,
      }),
    );
  }

  /**
   * The compensating fact: an identifier this pass adopted from an `Account`
   * row that no longer exists is detached, so the projection never outlives
   * the legacy truth it was proven against. A refusal (the identifier is
   * PRIMARY, or already gone) is a parity fact the check reports, never a
   * park.
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
          commandId: `backfill:detach:${row.id}:${row.accountId}`,
          identifierId: row.id,
          occurredAtMs: this.now(),
          actor: IDENTITY_BACKFILL_ACTOR,
        }),
      );
    }
  }
}

/** A command the guards refused is a parity fact, never a park. */
async function tolerateRefusal(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof IdentityCommandRefusedError)) throw error;
  }
}

/**
 * What the legacy rows imply: the email identifier from `User.email`
 * (VERIFIED when `emailVerified`), and one identifier per `Account` row in
 * the state its provider arrives in (R8) — with the deterministic ids live
 * emission would derive for the same facts.
 */
export function expectedIdentifiers({
  user,
  accounts,
}: {
  user: BackfillUserRow & { email: string };
  accounts: BackfillAccountRow[];
}): Adoption[] {
  const normalizedValue = normalizeIdentifierValue(user.email);
  const expected = [
    {
      provider: "email" as const,
      providerAccountId: null,
      accountId: null,
      occurredAtMs: user.createdAtMs,
      commandId: `backfill:user-email:${user.id}`,
      value: normalizedValue,
      expectedState: user.emailVerified
        ? ("VERIFIED" as const)
        : ("ATTACHED" as const),
    },
    ...accounts.map((account) => {
      const provider = identifierProviderFor(account.provider);
      return {
        provider,
        providerAccountId: account.providerAccountId,
        accountId: account.id,
        occurredAtMs: account.createdAtMs,
        commandId: `backfill:${account.id}`,
        value: normalizedValue,
        expectedState: arrivalStateForProvider(provider),
      };
    }),
  ];
  return expected.map((expectation) => ({
    ...expectation,
    identifierId: deriveIdentifierId({
      userId: user.id,
      provider: expectation.provider,
      providerAccountId: expectation.providerAccountId,
      normalizedValue,
      occurredAtMs: expectation.occurredAtMs,
    }),
  }));
}
