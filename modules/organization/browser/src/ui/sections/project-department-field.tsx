import { HorizontalFormControl } from "@langwatch/design-system/horizontal-form-control";
import type { ProjectDepartmentFieldProps } from "@langwatch/organization-client";

import { useDepartmentColumn } from "../../behavior/use-department-column.ts";
import { DepartmentPicker } from "./department-picker.tsx";

/** A project's department row on its settings form, lent to project; absent while unused. */
export function ProjectDepartmentField({
  organizationId,
  projectId,
  governanceEnabled,
}: ProjectDepartmentFieldProps) {
  const department = useDepartmentColumn(organizationId, governanceEnabled);
  if (!department.show) return null;

  return (
    <HorizontalFormControl
      label="Department"
      helper="Agent spend with no human principal rolls up to this department"
    >
      <DepartmentPicker
        organizationId={organizationId}
        kind="project"
        entityId={projectId}
        value={department.byProject.get(projectId) ?? null}
        departments={department.departments}
        onAssigned={department.refetch}
      />
    </HorizontalFormControl>
  );
}
