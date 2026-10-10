import { Menu } from "@langwatch/design-system/menu";
import { Copy, MoreVertical } from "react-feather";
import { LuEye, LuPencil, LuTrash } from "react-icons/lu";

import {
  isEditable,
  resultsPathOf,
  workbenchPathOf,
  type ExperimentListRow,
} from "../../../model/experiments/experiment-list-row.ts";

export type ExperimentPermissions = { canEdit: boolean; canReplicate: boolean; canDelete: boolean };

/** The row's ⋮ menu: edit, view results, replicate, delete, each behind the person's permission. */
export const ExperimentActionsMenu = ({
  experiment,
  projectSlug,
  permissions,
  onOpen,
  onReplicate,
  onDelete,
}: {
  experiment: ExperimentListRow;
  projectSlug: string;
  permissions: ExperimentPermissions;
  onOpen: (path: string) => void;
  onReplicate: () => void;
  onDelete: () => void;
}) => (
  <Menu.Root>
    <Menu.Trigger
      aria-label={`Actions for ${experiment.name ?? experiment.slug}`}
      onClick={(e) => e.stopPropagation()}
    >
      <MoreVertical size={16} />
    </Menu.Trigger>
    <Menu.Content onClick={(e) => e.stopPropagation()}>
      {permissions.canEdit && isEditable(experiment) && (
        <Menu.Item
          value="edit"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(workbenchPathOf(projectSlug, experiment));
          }}
        >
          <LuPencil size={16} />
          Edit
        </Menu.Item>
      )}
      <Menu.Item
        value="view-results"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(resultsPathOf(projectSlug, experiment));
        }}
      >
        <LuEye size={16} />
        View results
      </Menu.Item>
      {permissions.canReplicate && (
        <Menu.Item
          value="replicate"
          onClick={(e) => {
            e.stopPropagation();
            onReplicate();
          }}
        >
          <Copy size={16} />
          Replicate to another project
        </Menu.Item>
      )}
      {permissions.canDelete && (
        <Menu.Item
          value="delete"
          color="red.fg"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <LuTrash size={16} />
          Delete
        </Menu.Item>
      )}
    </Menu.Content>
  </Menu.Root>
);
