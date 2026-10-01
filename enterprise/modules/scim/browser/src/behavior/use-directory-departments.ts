// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Governance's departments, named on the card once AI governance is on and any exist. */
import { departmentsApi } from "./scim-api.ts";

export const GOVERNANCE_FLAG = "release_ui_ai_governance_enabled";

export function useDirectoryDepartments({
  organizationId,
  governanceEnabled,
}: {
  organizationId: string;
  governanceEnabled: boolean;
}) {
  const list = departmentsApi.departments.list.useQuery(
    { organizationId },
    { enabled: governanceEnabled && !!organizationId, refetchOnWindowFocus: false },
  );
  const departments = list.data ?? [];
  return { show: governanceEnabled && departments.length > 0, departments };
}
