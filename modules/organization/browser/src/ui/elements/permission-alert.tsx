/** Permission restriction notice: shown in place of restricted content. */

import { RestrictedAccess } from "@langwatch/design-system/restricted-access";

export function PermissionAlert({ area, permission }: { permission: string; area?: string }) {
  return <RestrictedAccess permission={permission} {...(area ? { area } : {})} />;
}
