import { PrismaProcessStore } from "@langwatch/eventing/server";
import { generate } from "@langwatch/ksuid";
import type { OrganizationAuditRecordedEventData } from "@langwatch/organization-contract";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

import { organizationAuditAppend } from "../../rules/organization-audit.rules.ts";

/** One audited change, as its repository knows it; the key and its moment are minted here. */
type OrganizationAuditFact = Omit<
  OrganizationAuditRecordedEventData,
  "occurredAt" | "idempotencyKey"
>;

/**
 * Organization's audit outbox over its own Postgres (precedent prisma.automation.repositories.ts):
 * the intent is written through the caller's transaction, so it commits or rolls back with the
 * change. The process store is opened on first use, as a stand-in client never audits.
 */
export class PrismaOrganizationAuditStore {
  static create({ database }: { database: PrismaClient }): PrismaOrganizationAuditStore {
    return new PrismaOrganizationAuditStore(database);
  }

  #outbox: PrismaProcessStore | undefined;

  private constructor(private readonly database: PrismaClient) {}

  async append({
    fact,
    transaction,
  }: {
    fact: OrganizationAuditFact;
    transaction: Prisma.TransactionClient;
  }): Promise<void> {
    const key = generate("audit");
    this.#outbox ??= PrismaProcessStore.create({ database: this.database });
    await this.#outbox.appendIntents({
      ...organizationAuditAppend({
        fact: {
          ...fact,
          occurredAt: key.date.getTime(),
          idempotencyKey: key.toString(),
        },
      }),
      transaction,
    });
  }
}
