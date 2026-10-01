import type { UiProjectDepartmentFieldProps } from "@langwatch/browser-host/declarations";

import { useDepartmentColumn } from "../../behavior/use-department-column.ts";
import { HorizontalFormControl } from "../elements/horizontal-form-control.tsx";
import { DepartmentPicker } from "./department-picker.tsx";

/** A project's department row on its settings form, lent to project; absent while unused. */
export function ProjectDepartmentField({
  organizationId,
  projectId,
  governanceEnabled,
}: UiProjectDepartmentFieldProps) {
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
