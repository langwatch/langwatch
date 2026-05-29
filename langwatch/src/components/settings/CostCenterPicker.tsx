import { NativeSelect } from "@chakra-ui/react";

import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

import type { CostCenterOption } from "./useCostCenterColumn";

/**
 * Inline single-select that assigns a person / team / project to a cost
 * center where it is already managed (members page, teams page, project
 * settings). Single-valued: picking a center replaces the previous one,
 * "Unassigned" clears it. Owns the assign mutation so call sites only pass
 * the current value + the option list.
 */
export function CostCenterPicker({
  organizationId,
  kind,
  entityId,
  value,
  costCenters,
  onAssigned,
}: {
  organizationId: string;
  kind: "user" | "team" | "project";
  entityId: string;
  value: string | null;
  costCenters: CostCenterOption[];
  onAssigned: () => Promise<unknown> | void;
}) {
  const assignUser = api.costCenters.assignUser.useMutation();
  const assignTeam = api.costCenters.assignTeam.useMutation();
  const assignProject = api.costCenters.assignProject.useMutation();

  const isPending =
    assignUser.isPending || assignTeam.isPending || assignProject.isPending;

  const assign = async (costCenterId: string | null) => {
    try {
      if (kind === "user") {
        await assignUser.mutateAsync({
          organizationId,
          userId: entityId,
          costCenterId,
        });
      } else if (kind === "team") {
        await assignTeam.mutateAsync({
          organizationId,
          teamId: entityId,
          costCenterId,
        });
      } else {
        await assignProject.mutateAsync({
          organizationId,
          projectId: entityId,
          costCenterId,
        });
      }
      toaster.create({ title: "Cost center updated", type: "success" });
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
    <NativeSelect.Root size="sm" minW="160px" maxW="220px" disabled={isPending}>
      <NativeSelect.Field
        value={value ?? ""}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
          void assign(e.target.value || null)
        }
      >
        <option value="">Unassigned</option>
        {costCenters.map((cc) => (
          <option key={cc.id} value={cc.id}>
            {cc.name}
          </option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}
