import { identifierProviderFor } from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";
import type { Where } from "better-auth";
import { nanoid } from "nanoid";
import type { IdentityHeadsRepository } from "../identity-heads.repository";
import type { IdentityCeremonyWrites } from "../identity-writes";
import type { AdapterRows } from "./adapter-rows";
import type {
  IdentityCeremonyClock,
  IdentityWriteGate,
} from "./adapter-types";

const logger = createLogger("langwatch:better-auth:identity-adapter");

interface AccountRow {
  id: string;
  userId: string;
  providerId: string;
  accountId: string;
}

/** The fields an `Account` create carries that the ceremony needs. */
interface AccountCreateIntent {
  userId: string;
  providerId: string;
  providerAccountId: string | null;
  accountId: string;
  occurredAtMs: number;
}

/**
 * What an `Account` row write MEANS in identity terms (ADR-101 §2). A row
 * created inside a sign-up or link flow is an identifier attach; a row
 * deleted is a detach.
 *
 * Both halves run BEFORE the row write, and that ordering is the contract:
 * the guards veto while no row exists yet, so a refused ceremony refuses
 * the protocol write with it. Nothing here decides WHETHER it runs — the
 * facade routes the write and calls this only for domain-significant
 * `account` operations, so routing lives in exactly one place.
 */
export class AccountCeremony {
  constructor(
    private readonly rows: AdapterRows,
    private readonly heads: IdentityHeadsRepository,
    private readonly identity: IdentityCeremonyWrites,
    private readonly isLatched: IdentityWriteGate,
    private readonly clock: IdentityCeremonyClock,
  ) {}

  /**
   * The live attach must derive the SAME identifier id the backfill will
   * derive from the row later (ADR-101 §3: backfill and live emission
   * converge). The id derives from `(userId, provider, providerAccountId,
   * value, occurredAt)`, and the backfill takes `occurredAt` from
   * `Account.createdAt` and links the row by `Account.id` — so the ceremony
   * reads `createdAt` off the row better-auth is about to write and mints
   * the row's id up front (the adapter factory honours a caller-set id on
   * `create`), then hands both to the attach.
   *
   * Returns the data the row write must use, id included.
   */
  async beforeCreate(
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const intent = this.createIntent(data);
    if (!intent) return data;
    if (!(await this.isLatched({ userId: intent.userId }))) return data;

    const value = await this.userEmail(intent.userId);
    if (!value) {
      logger.warn(
        { userId: intent.userId, providerId: intent.providerId },
        "latched user's account ceremony carries no email value; no identifier attached",
      );
      return data;
    }
    // Guards veto HERE, before the Account row exists; the facts land
    // durably (waited) and fold on the calling path before the row write.
    await this.identity.attachIdentifier({
      tenantId: intent.userId,
      userId: intent.userId,
      commandId: this.clock.newCommandId(),
      accountId: intent.accountId,
      provider: identifierProviderFor(intent.providerId),
      providerAccountId: intent.providerAccountId,
      value,
      occurredAtMs: intent.occurredAtMs,
      ceremony: { flow: "better-auth" },
      actor: { type: "user", id: intent.userId },
    });
    return { ...data, id: intent.accountId };
  }

  /**
   * Detach every identifier the rows about to be deleted mirror, and answer
   * the ids the protocol delete must pin itself to.
   */
  async beforeDelete({ where }: { where: Where[] }): Promise<string[]> {
    const rows = await this.rows.findAll<AccountRow>({
      model: "account",
      where,
    });
    for (const row of rows) {
      await this.detachFor(row);
    }
    return rows.map((row) => row.id);
  }

  private async detachFor(row: AccountRow): Promise<void> {
    if (!(await this.isLatched({ userId: row.userId }))) return;
    const identifierId = await this.heads.findIdentifierIdForAccount({
      userId: row.userId,
      accountId: row.id,
      provider: identifierProviderFor(row.providerId),
    });
    if (identifierId === null) {
      // Nothing in the projection mirrors this row (adopted before the
      // projection carried accountIds, or ambiguous). The protocol delete
      // must still happen; the backfill's next pass detaches whatever the
      // row's absence implies.
      logger.warn(
        { userId: row.userId, accountId: row.id, providerId: row.providerId },
        "no unambiguous Identifier mirrors the Account row being deleted; protocol delete proceeds, the backfill reconciles",
      );
      return;
    }
    await this.identity.detachIdentifier({
      tenantId: row.userId,
      userId: row.userId,
      commandId: this.clock.newCommandId(),
      identifierId,
      occurredAtMs: this.clock.now(),
      actor: { type: "user", id: row.userId },
    });
  }

  private createIntent(
    data: Record<string, unknown>,
  ): AccountCreateIntent | null {
    const { userId, providerId, accountId, id, createdAt } = data;
    if (typeof userId !== "string" || typeof providerId !== "string") {
      return null;
    }
    return {
      userId,
      providerId,
      providerAccountId: typeof accountId === "string" ? accountId : null,
      // Minted the same way the schema's own `@default(nanoid())` would mint
      // it — this id is persisted via `forceAllowId`, so it must match.
      accountId: typeof id === "string" ? id : nanoid(),
      occurredAtMs:
        createdAt instanceof Date ? createdAt.getTime() : this.clock.now(),
    };
  }

  private async userEmail(userId: string): Promise<string | null> {
    const user = await this.rows.findOne<{ email: string | null }>({
      model: "user",
      where: [{ field: "id", value: userId }],
    });
    return user?.email ?? null;
  }
}
