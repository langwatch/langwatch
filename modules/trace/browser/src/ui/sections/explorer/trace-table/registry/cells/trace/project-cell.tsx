import { Text } from "@langwatch/design-system/primitives";

import type { TraceListItem } from "../../../../../../../behavior/explorer/types/trace.ts";
import { MonoCell } from "../../../../../../elements/explorer/trace-table/mono-cell.tsx";
import { dash } from "../../../../../../elements/explorer/trace-table/registry/cells/dash-placeholder.tsx";
import { useMemberProjectName } from "../../../../hooks/use-member-project-name.ts";
import type { CellDef } from "../../types.ts";

function MemberProjectName({
  projectId,
  comfortable,
}: {
  projectId: string | undefined;
  comfortable: boolean;
}) {
  const name = useMemberProjectName(projectId) ?? dash;
  return comfortable ? (
    <Text textStyle="sm" color="fg.muted" truncate>
      {name}
    </Text>
  ) : (
    <MonoCell color="fg.subtle" truncate whiteSpace={undefined}>
      {name}
    </MonoCell>
  );
}

/**
 * The member project a row was listed from, on an aggregate project
 * (ADR-177). Only the aggregate's lens carries this column.
 */
export const ProjectCell = {
  id: "project",
  label: "Project",
  render: ({ row }) => <MemberProjectName projectId={row.projectId} comfortable={false} />,
  renderComfortable: ({ row }) => <MemberProjectName projectId={row.projectId} comfortable />,
} as const satisfies CellDef<TraceListItem>;
