import { Lent } from "@langwatch/browser-host/lent";
import { Banner } from "@langwatch/design-system/banner";
import { RequestAccessToken } from "@langwatch/organization-client";
import { Eye } from "lucide-react";

import { useLiteMemberGuard } from "../../behavior/personal-workspace-session.ts";

/**
 * View-only notice for Lite Members (organization role caps writes), with organization's
 * Request access for the full seat that lifts it.
 */
export function PersonalWorkspaceViewOnlyNotice() {
  const { isLiteMember } = useLiteMemberGuard();

  if (!isLiteMember) return null;

  return (
    <Banner
      status="info"
      icon={<Eye size={16} aria-hidden />}
      data-testid="personal-workspace-view-only-notice"
      action={<Lent of={RequestAccessToken} props={{ reason: "add_to_workspace" }} />}
    >
      Your organization gives you view-only access, so you can read your workspace but not add to
      it. Request access to ask an organization admin for a full seat.
    </Banner>
  );
}
