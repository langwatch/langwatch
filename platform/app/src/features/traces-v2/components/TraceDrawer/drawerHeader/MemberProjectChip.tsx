import { LuFolder } from "react-icons/lu";
import { useMemberProjectName } from "../../../hooks/useMemberProjectName";
import { useDrawerStore } from "../../../stores/drawerStore";
import { Chip } from "../Chip";

/**
 * The member project the open trace belongs to, on an aggregate project
 * (ADR-144). The drawer is told the member only there, so this renders
 * nothing on every other project.
 */
export function MemberProjectChip() {
  const tenantId = useDrawerStore((s) => s.tenantId);
  const name = useMemberProjectName(tenantId);
  if (!name) return null;
  return (
    <Chip
      icon={LuFolder}
      label="Project"
      value={name}
      tone="neutral"
      ariaLabel={`Project: ${name}`}
    />
  );
}
