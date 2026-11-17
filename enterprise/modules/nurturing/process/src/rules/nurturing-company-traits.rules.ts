// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioOrgTraits } from "@langwatch/enterprise-nurturing-contract";

import { unixSecondsOf } from "./nurturing-customer-io-timestamp.rules.ts";

type CompanyTraits = Partial<Pick<CioOrgTraits, "member_count" | "project_count" | "created_at">>;

/**
 * The company's size and age for its group call only, never a member's. A trait nurturing's own
 * copies do not hold is left out, and so is a zero count: an organization has a member and a
 * project, so zero means the copy is missing, and Customer.io would keep a wrong value.
 */
export function companyTraits({
  memberCount,
  projectCount,
  organizationCreatedAt,
}: Readonly<{
  memberCount: number | null;
  projectCount: number | null;
  /** Epoch ms; null when nurturing never saw the organization created. */
  organizationCreatedAt: number | null;
}>): CompanyTraits {
  return {
    ...(memberCount !== null && memberCount > 0 && { member_count: memberCount }),
    ...(projectCount !== null && projectCount > 0 && { project_count: projectCount }),
    ...(organizationCreatedAt !== null && { created_at: unixSecondsOf(organizationCreatedAt) }),
  };
}
