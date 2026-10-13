import { Banner } from "@langwatch/design-system/banner";
import { Eye } from "lucide-react";

import { useLiteMemberGuard } from "../../behavior/personal-workspace-session.ts";

/**
 * View-only notice for Lite Members (organization role caps writes).
 */
export function PersonalWorkspaceViewOnlyNotice() {
  const { isLiteMember } = useLiteMemberGuard();

  if (!isLiteMember) return null;

  return (
    <Banner
      status="info"
      icon={<Eye size={16} aria-hidden />}
      data-testid="personal-workspace-view-only-notice"
    >
      Your organization gives you view-only access, so you can read your workspace but not add to
      it. Ask an organization admin if you need to change something here.
    </Banner>
  );
}
