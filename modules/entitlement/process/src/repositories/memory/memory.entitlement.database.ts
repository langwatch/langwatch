import type { ProjectSpendRollup } from "@langwatch/entitlement-contract";

/** One organization's membership counts and its month's spend, as rows. */
export type MemoryOrganizationUsage = Readonly<{
  organizationId: string;
  memberCount: number;
  membersLiteCount: number;
  currentMonthCost: number;
  /** The projects the organization owns, and what each has spent this month. */
  projectCosts: Readonly<Record<string, number>>;
  /** The rollup the spend reader answers, per user allowed to see it. */
  spendByUserId: Readonly<Record<string, readonly ProjectSpendRollup[]>>;
  /** Organization's columns entitlement reads; absent reads as the schema's default. */
  currency?: "USD" | "EUR";
  datasetAttachmentMaxMb?: number | null;
}>;

/** The in-memory tables entitlement's Postgres readers share. */
export class MemoryEntitlementDatabase {
  #organizations = new Map<string, MemoryOrganizationUsage>();

  static create(): MemoryEntitlementDatabase {
    return new MemoryEntitlementDatabase();
  }

  put(usage: MemoryOrganizationUsage): void {
    this.#organizations.set(usage.organizationId, usage);
  }

  find(organizationId: string): MemoryOrganizationUsage | undefined {
    return this.#organizations.get(organizationId);
  }

  all(): MemoryOrganizationUsage[] {
    return [...this.#organizations.values()];
  }
}
