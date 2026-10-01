// The kit's grant dialog, fed from this module's queries and saved through its mutations.

import { useState } from "react";

import { useGrantDialogData } from "../../behavior/use-grant-dialog-data.ts";
import { useGrantSave } from "../../behavior/use-grant-mutations.ts";
import { useAuthzHost } from "../../model/authz-host.ts";
import { type GrantRow } from "../../model/grants/grants.ts";
import { GrantDialog, type GrantScope } from "./grants/grant-dialog.tsx";

export function AccessGrantDialog({
  organizationId,
  editing,
  onClose,
}: {
  organizationId: string;
  editing: GrantRow | null;
  onClose: () => void;
}) {
  const host = useAuthzHost();
  const [scope, setScope] = useState<GrantScope>(
    editing?.scope ?? { type: "organization", id: organizationId },
  );
  const data = useGrantDialogData({ organizationId, scope, isEditing: !!editing });
  const save = useGrantSave({ organizationId, onSaved: onClose });

  return (
    <GrantDialog
      organizationId={organizationId}
      editing={editing}
      structure={host.organizationStructure()}
      {...data}
      isSaving={save.isSaving}
      onScopeChange={setScope}
      onCreate={save.create}
      onChangeRole={save.changeRole}
      onClose={onClose}
    />
  );
}
