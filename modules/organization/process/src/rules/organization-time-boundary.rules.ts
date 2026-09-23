import type { OrganizationProvisioningSummary as OrganizationApiProvisioningSummary } from "@langwatch/organization-contract";
import { fromDate } from "@langwatch/time";
import type * as timeModule from "@langwatch/time";

import type {
  OrganizationMemberSummary,
  OrganizationProvisioningSummary as OrganizationServiceProvisioningSummary,
} from "../repositories/organization-membership.repository.ts";

export function organizationMemberDatesFromDate(member: OrganizationMemberSummary): {
  disabledAt: timeModule.Instant | null;
  createdAt: timeModule.Instant;
  updatedAt: timeModule.Instant;
} {
  return {
    disabledAt: member.disabledAt === null ? null : fromDate(member.disabledAt),
    createdAt: fromDate(member.createdAt),
    updatedAt: fromDate(member.updatedAt),
  };
}

export function organizationProvisioningSummaryFromDate(
  summary: OrganizationServiceProvisioningSummary,
): OrganizationApiProvisioningSummary {
  return { ...summary, createdAt: fromDate(summary.createdAt) };
}
