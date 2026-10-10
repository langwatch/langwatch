// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The People page's department filter, kept in the address so a view is
 * deep-linkable; its default stays out of it. Spec: specs/ai-governance/dashboard/people-tabs.feature
 */

import { useGovernanceSearchParams } from "../../../behavior/governance-router.ts";

export interface PeopleFilters {
  /** `null` is every department, including the people who have none. */
  department: string | null;
  setDepartment: (next: string | null) => void;
}

/** The sort keeps its own hook because the detail listing page shares it. */
export function usePeopleFilters(): PeopleFilters {
  const [searchParams, setSearchParams] = useGovernanceSearchParams();

  return {
    department: searchParams.get("department"),
    setDepartment: (next) =>
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (next === null || next === "") params.delete("department");
          else params.set("department", next);
          return params;
        },
        { replace: true },
      ),
  };
}
