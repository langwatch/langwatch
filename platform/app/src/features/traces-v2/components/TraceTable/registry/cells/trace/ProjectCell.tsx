import { Text } from "@chakra-ui/react";
import { useMemberProjectName } from "../../../../../hooks/useMemberProjectName";
import type { TraceListItem } from "../../../../../types/trace";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";
import { dash } from "../dashPlaceholder";

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
 * (ADR-144). Only the aggregate's lens carries this column.
 */
export const ProjectCell = {
  id: "project",
  label: "Project",
  render: ({ row }) => (
    <MemberProjectName projectId={row.projectId} comfortable={false} />
  ),
  renderComfortable: ({ row }) => (
    <MemberProjectName projectId={row.projectId} comfortable />
  ),
} as const satisfies CellDef<TraceListItem>;
