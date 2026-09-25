// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  AnomalyAlertDispatchRecord,
  AnomalyRule,
  Department,
  IngestionTemplate,
  RoutingPolicy,
} from "@langwatch/enterprise-governance-contract";
import type { Instant } from "@langwatch/time";

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
/** One dated member-to-department link; `validTo` null is the open one. */
export type MemoryDepartmentMembershipLink = {
  id: string;
  organizationId: string;
  userId: string;
  departmentId: string;
  validFrom: Instant;
  validTo: Instant | null;
};


/** An alert the spend-spike evaluator has already raised for a rule. */
export type MemoryGovernanceAlert = AnomalyAlertDispatchRecord & {
  ruleId: string;
  open: boolean;
  dispatches: Record<string, unknown>[];
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
  readonly departmentMemberships: MemoryDepartmentMembershipLink[] = [];
  readonly departments: Department[] = [];
  readonly ingestionTemplates: IngestionTemplate[] = [];
  readonly anomalyRules: AnomalyRule[] = [];
  readonly routingPolicies: RoutingPolicy[] = [];
  readonly alerts: MemoryGovernanceAlert[] = [];

  static create(): MemoryGovernanceStore {
    return new MemoryGovernanceStore();
  }
}
