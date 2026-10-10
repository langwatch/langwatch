// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { OrganizationApi } from "@langwatch/organization-contract";
// Authz's active-administrator read, as a double: it answers nobody by
// default, so a test that says nothing about administration removes someone
// who is not the last administrator.
import { vi } from "vitest";

import type { ScimOrganizationAdministration } from "../../services/scim-deprovision.service.ts";

export class OrganizationAdministrationFake implements ScimOrganizationAdministration {
  readonly findActiveOrganizationAdministrators = vi.fn(async (): Promise<string[]> => []);
}

/** Organization's member removal, which a SCIM delete asks for with no acting user. */
export class MembersFake implements Pick<OrganizationApi, "deleteMember"> {
  readonly deleteMember = vi.fn(async (): Promise<void> => undefined);
}
