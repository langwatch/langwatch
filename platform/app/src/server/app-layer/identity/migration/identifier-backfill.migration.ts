/**
 * D01 PR 2 — the identifier backfill: every sign-in method a user already
 * holds becomes identity history (ADR-101 §6), the grants genesis-import
 * discipline re-tenanted to users.
 *
 * Adoption, not re-creation: command ids derive from the source rows
 * (`backfill:<accountId>`, `backfill:user-email:<userId>`), business time is
 * each row's own `createdAt`, and the deterministic identifier ids derive
 * from both — so a re-run appends the same events, the store dedupes them,
 * and live emission of the same fact converges on the same projection row.
 *
 * Self-proving: `finalized` only when the fold-built `Identifier` rows match
 * what the live `Account`/`User` rows imply — a disagreement holds the user
 * at `migrated` with a bounded diff report on the ops migrations page, and a
 * later pass retries the proof. Finalization is the LATCH: the adapter's
 * per-user write gate (identifier-write-gate.ts) reads exactly this record,
 * so the moment this migration finalizes a user, their domain-significant
 * better-auth writes start emitting identity events structurally.
 *
 * Emission rides the calling-path dispatcher (`IdentityCeremonies`): guards
 * veto, the append lands waited, the fold applies before this migration
 * reads the rows back for its own proof — read-your-writes is what makes
 * the proof meaningful in a single pass.
 *
 * Spec: specs/identity/identifier-model.feature ("The backfill adopts
 * existing accounts and proves itself per user").
 */
import type {
  SystemMigration,
  TenantMigrationOutcome,
} from "@langwatch/system-migrations";
import { identifierProviderFor } from "~/server/better-auth/identityDatabase";
import { IdentityCommandRefusedError } from "~/server/event-sourcing/pipelines/identity/commands/identityCommands";
import {
  arrivalStateForProvider,
  deriveIdentifierId,
  normalizeIdentifierValue,
} from "~/server/event-sourcing/pipelines/identity/projections/identifierIdentity";
import type { IdentifierProvider } from "~/server/event-sourcing/pipelines/identity/schemas/events";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../identifier-write-gate";
import type { IdentityCeremonies } from "../identity-ceremonies";

export const IDENTITY_BACKFILL_ACTOR_ID = "system:identity-backfill" as const;

const BACKFILL_ACTOR = {
  type: "system" as const,
  id: IDENTITY_BACKFILL_ACTOR_ID,
};

/** Reports stay bounded however far a projection has drifted. */
const MAX_REPORTED_DIFFS = 50;

export interface BackfillUserRow {
  id: string;
  email: string | null;
  emailVerified: boolean;
  createdAtMs: number;
  userHashKey: string | null;
}

export interface BackfillAccountRow {
  id: string;
  provider: string;
  providerAccountId: string;
  createdAtMs: number;
}

export interface BackfillIdentifierRow {
  id: string;
  provider: string;
  value: string | null;
  accountId: string | null;
  state: string;
}

/** The legacy truth and the projection, as this migration reads them. */
export interface IdentityBackfillReads {
  findUser(params: { userId: string }): Promise<BackfillUserRow | null>;
  /** Mint `User.userHashKey` when absent, so adopted identifiers carry real
   *  hashes; a no-op when one exists. */
  mintUserHashKeyIfMissing(params: { userId: string }): Promise<void>;
  findAccountRows(params: { userId: string }): Promise<BackfillAccountRow[]>;
  findIdentifierRows(params: {
    userId: string;
  }): Promise<BackfillIdentifierRow[]>;
}

export type BackfillDiff = {
  kind: "identifier_missing" | "state_mismatch" | "value_mismatch";
  identifierId: string;
  provider: string;
  expectedState?: string;
  actualState?: string;
};

interface ExpectedIdentifier {
  identifierId: string;
  provider: IdentifierProvider;
  value: string;
  /** VERIFIED-or-better; ATTACHED means exactly ATTACHED is acceptable too. */
  expectedState: "ATTACHED" | "VERIFIED";
}

export interface IdentifierBackfillMigrationDeps {
  reads: IdentityBackfillReads;
  ceremonies: Pick<IdentityCeremonies, "attachIdentifier" | "verifyIdentifier">;
}

export class IdentityIdentifierBackfillMigration implements SystemMigration {
  // Never rename: the stable state-table key. The write gate reads exactly
  // this record, so the latch and the migration share the one constant.
  readonly name = IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME;
  readonly title = "Identifier history backfill";
  readonly description =
    "Records each member's existing sign-in methods as identity history and " +
    "verifies the recorded data matches their accounts. Sign-in behavior " +
    "does not change.";
  // Dark preparation: finalization opens event EMISSION for the user; no
  // decision, no sign-in behavior and nothing customer-visible changes.
  readonly requiresOperatorConfirmation = false;
  // Ships inert on self-hosted until a release flips this after the cloud
  // rollout has soaked (the in-place doctrine's release act).
  readonly runsAutomaticallyOnSelfHosted = false;

  constructor(private readonly deps: IdentifierBackfillMigrationDeps) {}

  async migrateTenant({
    tenantId,
  }: {
    tenantId: string;
  }): Promise<TenantMigrationOutcome> {
    const userId = tenantId;
    const user = await this.deps.reads.findUser({ userId });
    if (!user) {
      // A vanished user has no history to adopt and no gate to open that
      // anything would consult; finalizing records that this pass looked.
      return { status: "finalized", report: { kind: "user_missing" } };
    }
    if (!user.email) {
      // Identifier values derive from the user's email; a user without one
      // (mid-erasure, or an import artifact) cannot be adopted yet. Held,
      // not parked: the report says why, and a later pass retries.
      return {
        status: "migrated",
        report: { kind: "no_email", userId },
      };
    }
    if (user.userHashKey === null) {
      await this.deps.reads.mintUserHashKeyIfMissing({ userId });
    }

    const accounts = await this.deps.reads.findAccountRows({ userId });
    const expected = expectedIdentifiers({ user, accounts });

    for (const adoption of expected) {
      await this.deps.ceremonies.attachIdentifier({
        tenantId: userId,
        userId,
        commandId: adoption.commandId,
        accountId: adoption.accountId,
        provider: adoption.provider,
        providerAccountId: adoption.providerAccountId,
        value: user.email,
        occurredAtMs: adoption.occurredAtMs,
        ceremony: { flow: "backfill" },
        actor: BACKFILL_ACTOR,
      });
    }

    // The email identifier's establishment: a verified User.email means the
    // mailbox ceremony (or an equivalent) already happened — recorded with
    // method "creation", no Verification record to cite. A refusal here is
    // a parity fact (the identifier dead-ended or detached), never a park:
    // the diff below reports it and the user is held.
    const emailExpectation = expected.find(
      (candidate) => candidate.provider === "email",
    );
    if (emailExpectation && user.emailVerified) {
      try {
        await this.deps.ceremonies.verifyIdentifier({
          tenantId: userId,
          userId,
          commandId: `backfill:verify-email:${userId}`,
          identifierId: emailExpectation.identifierId,
          verificationId: null,
          method: "creation",
          occurredAtMs: user.createdAtMs,
          actor: BACKFILL_ACTOR,
        });
      } catch (error) {
        if (!(error instanceof IdentityCommandRefusedError)) throw error;
      }
    }

    const diffs = await this.proveParity({ userId, expected });
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

  /** The D01 exit gate: the fold-built rows against what the live rows imply. */
  private async proveParity({
    userId,
    expected,
  }: {
    userId: string;
    expected: Array<ExpectedIdentifier & { commandId: string }>;
  }): Promise<BackfillDiff[]> {
    const rows = await this.deps.reads.findIdentifierRows({ userId });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const diffs: BackfillDiff[] = [];
    for (const expectation of expected) {
      const row = byId.get(expectation.identifierId);
      if (!row) {
        diffs.push({
          kind: "identifier_missing",
          identifierId: expectation.identifierId,
          provider: expectation.provider,
          expectedState: expectation.expectedState,
        });
        continue;
      }
      if (!stateSatisfies(row.state, expectation.expectedState)) {
        diffs.push({
          kind: "state_mismatch",
          identifierId: expectation.identifierId,
          provider: expectation.provider,
          expectedState: expectation.expectedState,
          actualState: row.state,
        });
      }
      if (row.value !== expectation.value) {
        diffs.push({
          kind: "value_mismatch",
          identifierId: expectation.identifierId,
          provider: expectation.provider,
        });
      }
    }
    return diffs;
  }
}

/** ATTACHED is satisfied by any live state; VERIFIED by VERIFIED-or-PRIMARY. */
function stateSatisfies(
  actual: string,
  expected: "ATTACHED" | "VERIFIED",
): boolean {
  if (expected === "VERIFIED") {
    return actual === "VERIFIED" || actual === "PRIMARY";
  }
  return actual === "ATTACHED" || actual === "VERIFIED" || actual === "PRIMARY";
}

function expectedIdentifiers({
  user,
  accounts,
}: {
  user: BackfillUserRow & { email: string };
  accounts: BackfillAccountRow[];
}): Array<
  ExpectedIdentifier & {
    commandId: string;
    accountId: string | null;
    providerAccountId: string | null;
    occurredAtMs: number;
  }
> {
  const normalizedValue = normalizeIdentifierValue(user.email);
  const expected = [
    {
      provider: "email" as const,
      providerAccountId: null,
      accountId: null,
      occurredAtMs: user.createdAtMs,
      commandId: `backfill:user-email:${user.id}`,
      value: normalizedValue,
      expectedState: (user.emailVerified ? "VERIFIED" : "ATTACHED") as
        | "ATTACHED"
        | "VERIFIED",
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
        // OAuth/credential ceremonies arrived verified when the row was
        // minted (R8) — the arrival rule the live path uses.
        expectedState:
          arrivalStateForProvider(provider) === "VERIFIED"
            ? ("VERIFIED" as const)
            : ("ATTACHED" as const),
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
