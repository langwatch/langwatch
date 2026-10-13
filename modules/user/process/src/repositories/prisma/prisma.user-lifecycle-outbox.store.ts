import { PrismaProcessStore } from "@langwatch/eventing/server";

import { type UserFactIntent, userFactsAppend } from "../../rules/user-lifecycle-outbox.rules.ts";

/**
 * User's fact outbox over its own Postgres (precedent prisma.organization-audit.store.ts): the
 * intents are written through the caller's transaction, so they commit or roll back with the
 * change. The process store is opened on first use.
 */
export class PrismaUserLifecycleOutboxStore {
  static create({ database }: { database: object }): PrismaUserLifecycleOutboxStore {
    return new PrismaUserLifecycleOutboxStore(database);
  }

  #outbox: PrismaProcessStore | undefined;

  private constructor(private readonly database: object) {}

  async append({
    userId,
    intents,
    now,
    transaction,
  }: {
    userId: string;
    intents: readonly UserFactIntent[];
    now: number;
    transaction: object;
  }): Promise<void> {
    this.#outbox ??= PrismaProcessStore.create({ database: this.database });
    await this.#outbox.appendIntents({ ...userFactsAppend({ userId, intents, now }), transaction });
  }
}
