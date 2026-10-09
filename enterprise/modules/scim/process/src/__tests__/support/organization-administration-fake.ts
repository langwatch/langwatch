// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

// Authz's active-administrator read, as a double: it answers nobody by
// default, so a test that says nothing about administration removes someone
// who is not the last administrator.
import { vi } from "vitest";

import type { ScimOrganizationAdministration } from "../../services/scim-deprovision.service.ts";

export class OrganizationAdministrationFake implements ScimOrganizationAdministration {
  readonly findActiveOrganizationAdministrators = vi.fn(async (): Promise<string[]> => []);
}
