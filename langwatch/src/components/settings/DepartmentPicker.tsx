import { NativeSelect } from "@chakra-ui/react";

import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

import type { DepartmentOption } from "./useDepartmentColumn";

/**
 * Inline single-select that assigns a person / team / project to a
 * department where it is already managed (members page, teams page, project
 * settings). Single-valued: picking a department replaces the previous one,
 * "Unassigned" clears it. Owns the assign mutation so call sites only pass
 * the current value + the option list.
 */
export function DepartmentPicker({
  organizationId,
  kind,
  entityId,
  value,
  departments,
  onAssigned,
  width,
}: {
  organizationId: string;
  kind: "user" | "team" | "project";
  entityId: string;
  value: string | null;
  departments: DepartmentOption[];
  onAssigned: () => Promise<unknown> | void;
  /**
   * Fixed width override. Members-table usage leaves this unset and relies on
   * the min/max range; the compact labeled variant on the teams page passes a
   * smaller fixed width.
   */
  width?: string;
}) {
  const assignUser = api.departments.assignUser.useMutation();
  const assignTeam = api.departments.assignTeam.useMutation();
  const assignProject = api.departments.assignProject.useMutation();

  const isPending =
    assignUser.isPending || assignTeam.isPending || assignProject.isPending;

  const assign = async (departmentId: string | null) => {
    try {
      if (kind === "user") {
        await assignUser.mutateAsync({
          organizationId,
          userId: entityId,
          departmentId,
        });
      } else if (kind === "team") {
        await assignTeam.mutateAsync({
          organizationId,
          teamId: entityId,
          departmentId,
        });
      } else {
        await assignProject.mutateAsync({
          organizationId,
          projectId: entityId,
          departmentId,
        });
      }
      toaster.create({ title: "Department updated", type: "success" });
      await onAssigned();
    } catch (e) {
      toaster.create({
        title: "Assignment failed",
        description: e instanceof Error ? e.message : String(e),
        type: "error",
      });
    }
  };

  return (
    <NativeSelect.Root
      size="sm"
      {...(width ? { width } : { minW: "160px", maxW: "220px" })}
      disabled={isPending}
    >
      <NativeSelect.Field
        value={value ?? ""}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
          void assign(e.target.value || null)
        }
      >
        <option value="">Unassigned</option>
        {departments.map((dept) => (
          <option key={dept.id} value={dept.id}>
            {dept.name}
          </option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}
