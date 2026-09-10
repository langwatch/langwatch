// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  AnomalyAlertDispatchRecord,
  AnomalyRule,
  Department,
  PersonalVirtualKey,
  RoutingPolicy,
} from "@langwatch/enterprise-governance-contract";
import type { GovernanceDirectoryProject } from "../../ports/governance-directory.port.ts";

/** A seat in an organization, and whether it still answers as active. */
export type MemoryGovernanceMember = {
  userId: string;
  organizationId: string;
  isAdmin: boolean;
  deactivated: boolean;
};

/** A person the directory names, and the workspace rows keyed to them. */
export type MemoryGovernancePerson = {
  name: string | null;
  email: string | null;
};

/** A project row the directory resolves a credential or a slug to. */
export type MemoryGovernanceProject = GovernanceDirectoryProject & {
  organizationId: string;
  apiKey: string;
  archived: boolean;
};

/** An alert the spend-spike evaluator has already raised for a rule. */
export type MemoryGovernanceAlert = AnomalyAlertDispatchRecord & {
  ruleId: string;
  open: boolean;
  dispatches: Array<Record<string, unknown>>;
};

/**
 * One store behind the governance memory tier, the way one Postgres schema
 * serves the Prisma tier: a department written through `departments` is what
 * the directory and the support-contact rows answer from.
 */
export class MemoryGovernanceStore {
  readonly people = new Map<string, MemoryGovernancePerson>();
  readonly supportContacts = new Map<string, string>();
  readonly governanceTenantIds = new Map<string, string>();
  readonly members: MemoryGovernanceMember[] = [];
  readonly projects: MemoryGovernanceProject[] = [];
  readonly departments: Department[] = [];
  readonly departmentOfUser = new Map<string, string | null>();
  readonly departmentOfTeam = new Map<string, string | null>();
  readonly departmentOfProject = new Map<string, string | null>();
  readonly anomalyRules: AnomalyRule[] = [];
  readonly routingPolicies: RoutingPolicy[] = [];
  readonly personalVirtualKeys: PersonalVirtualKey[] = [];
  readonly eligibleProviderIds = new Map<string, string[]>();
  readonly alerts: MemoryGovernanceAlert[] = [];

  static create(): MemoryGovernanceStore {
    return new MemoryGovernanceStore();
  }
}
