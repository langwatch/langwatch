/**
 * Shared stand-ins for the hosted-services unit tests.
 */
import type { IssuedLicenseRecord } from "../../registry/issuedLicense";
import type {
  ContractBudget,
  ContractBudgetStore,
} from "../contractBudget.service";

export const NOW = new Date("2026-09-19T12:00:00.000Z");
export const NEXT_YEAR = new Date("2027-09-19T12:00:00.000Z");
export const ACME = "org_acme";

let sequence = 0;

/** A registry row with the terms under test. Everything else is a plain active license. */
export function license(
  overrides: Partial<IssuedLicenseRecord> = {},
): IssuedLicenseRecord {
  const id = `il_${++sequence}`;
  return {
    id,
    licenseId: `lic_${id}`,
    tokenHash: `hash_${id}`,
    organizationId: ACME,
    organizationName: "ACME",
    email: "ops@acme.test",
    planType: "ENTERPRISE",
    maxMembers: 50,
    maxMembersLite: 0,
    issuedAt: NOW,
    expiresAt: NEXT_YEAR,
    source: "BACKOFFICE",
    issuedById: "user_operator",
    revokedAt: null,
    revokedById: null,
    revokedReason: null,
    supersededAt: null,
    replacesId: null,
    pendingDeliveryLicense: null,
    lastSyncAt: null,
    lastSyncVersion: null,
    reportedMembers: null,
    reportedMembersLite: null,
    services: ["instant_evals"],
    seatOverageAllowance: null,
    seatRateCents: null,
    seatCurrency: null,
    commitUsdCents: 100_000,
    overageEnabled: false,
    overageMaxUsdCents: null,
    instanceId: "instance-a",
    instanceBoundAt: NOW,
    virtualKeyId: `vk_${id}`,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export class InMemoryContractBudgetStore implements ContractBudgetStore {
  budget: ContractBudget | null = null;
  writes: { limitUsdCents: number; actorId: string }[] = [];

  async find() {
    return this.budget ? { ...this.budget } : null;
  }

  async create({
    limitUsdCents,
    operatorId,
  }: {
    organizationId: string;
    limitUsdCents: number;
    operatorId: string;
  }) {
    this.budget = { id: "budget_1", limitUsdCents, capSetByCustomer: false };
    this.writes.push({ limitUsdCents, actorId: operatorId });
  }

  async setLimit({
    limitUsdCents,
    capSetByCustomer,
    actorId,
  }: {
    organizationId: string;
    id: string;
    limitUsdCents: number;
    capSetByCustomer: boolean;
    actorId: string;
  }) {
    if (!this.budget) throw new Error("no budget to update");
    this.budget = { ...this.budget, limitUsdCents, capSetByCustomer };
    this.writes.push({ limitUsdCents, actorId });
  }
}
