// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OrganizationMemberSeats } from "@langwatch/organization-contract";

/**
 * The seats an organization holds, read through organization's declared shares (PC-SCIM-SEAT):
 * full and lite members, live invitations included, disabled and deactivated people excluded.
 */
export interface ScimSeatRepository {
  countMemberSeats(input: Readonly<{ organizationId: string }>): Promise<OrganizationMemberSeats>;
}
