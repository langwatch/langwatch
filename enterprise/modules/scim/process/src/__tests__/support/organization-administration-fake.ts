// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

// Authz's active-administrator read, as a double: it answers nobody by
// default, so a test that says nothing about administration removes someone
// who is not the last administrator.
import { vi } from "vitest";

import type { ScimMembers } from "../../channels/scim-channels.registry.ts";
import type { ScimOrganizationAdministration } from "../../services/scim-deprovision.service.ts";

export class OrganizationAdministrationFake implements ScimOrganizationAdministration {
  readonly findActiveOrganizationAdministrators = vi.fn(async (): Promise<string[]> => []);
}

/** Organization's member removal and seat holds, which a SCIM delete and create ask for. */
export class MembersFake implements ScimMembers {
  readonly deleteMember = vi.fn(async (): Promise<void> => undefined);
  readonly holdSeatOfDepartingMember = vi.fn(async (): Promise<void> => undefined);
  readonly takeBackHeldSeat = vi.fn(async (): Promise<void> => undefined);
  readonly openSeatRequestForAdmission = vi.fn(async (): Promise<void> => undefined);
}
