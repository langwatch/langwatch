// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

// The organization's last-administrator refusal, as a double: it answers
// nothing by default, so a test that says nothing about administration reads
// as an organization with somebody else left to administer it.
import { vi } from "vitest";

import type { ScimOrganizationAdministration } from "../../services/scim-deprovision.service.ts";

export class OrganizationAdministrationFake implements ScimOrganizationAdministration {
  readonly assertRemovalKeepsAnAdministrator = vi.fn(async (): Promise<void> => undefined);
}
