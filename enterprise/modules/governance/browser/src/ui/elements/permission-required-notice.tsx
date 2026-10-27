import { RestrictedAccess } from "@langwatch/design-system/restricted-access";

export function PermissionRequiredNotice({
  permission,
  detail,
}: {
  permission: string;
  detail?: string;
}) {
  return <RestrictedAccess permission={permission} area="this panel" detail={detail} compact />;
}
