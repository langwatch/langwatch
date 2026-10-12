import { Alert } from "@langwatch/design-system/primitives";
import { Eye } from "lucide-react";

import { useLiteMemberGuard } from "../../behavior/personal-workspace-session.ts";

/**
 * View-only notice for Lite Members (organization role caps writes).
 */
export function PersonalWorkspaceViewOnlyNotice() {
  const { isLiteMember } = useLiteMemberGuard();

  if (!isLiteMember) return null;

  return (
    <Alert.Root status="neutral" data-testid="personal-workspace-view-only-notice">
      <Alert.Indicator>
        <Eye />
      </Alert.Indicator>
      <Alert.Content>
        <Alert.Description>
          Your organization gives you view-only access, so you can read your workspace but not add
          to it. Ask an organization admin if you need to change something here.
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
