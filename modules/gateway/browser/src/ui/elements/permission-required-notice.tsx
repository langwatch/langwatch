import { RestrictedAccess } from "@langwatch/design-system/restricted-access";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { z } from "zod";

import { isPermissionRefusal } from "../../model/permission-refusal.ts";

export function PermissionRefusedNotice({ error, detail }: { error: unknown; detail?: string }) {
  if (!isPermissionRefusal(error)) return null;
  const handled = readHandledError(error);
  const permission = z
    .string()
    .safeParse(handled?.meta.permission ?? handled?.meta.required_permission);
  return (
    <RestrictedAccess
      area="this panel"
      compact
      detail={detail}
      permission={permission.success ? permission.data : void 0}
    />
  );
}

export function PermissionRequiredNotice({
  permission,
  detail,
}: {
  permission: string;
  detail?: string;
}) {
  return <RestrictedAccess permission={permission} area="this panel" detail={detail} compact />;
}
