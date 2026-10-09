import { Chip } from "@langwatch/design-system/chip";
import { LuFolder } from "react-icons/lu";

import { useTraceDrawer } from "../../../../../behavior/trace-drawer.ts";
import { useMemberProjectName } from "../../hooks/use-member-project-name.ts";

/**
 * The member project the open trace belongs to, on an aggregate project (ADR-177). The
 * drawer is told the member only there, so this renders nothing on every other project.
 */
export function MemberProjectChip() {
  const tenantId = useTraceDrawer((s) => s.tenantId);
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
