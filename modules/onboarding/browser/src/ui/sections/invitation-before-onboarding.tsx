import type React from "react";
import { useEffect } from "react";

import { usePendingInvitation } from "../../behavior/use-pending-invitation.ts";
import { useOnboardingHost } from "../../model/onboarding-host.ts";
import { LoadingScreen } from "../blocks/loading-screen.tsx";

/**
 * Sends somebody holding a pending invitation to it before the screen that
 * creates an organization, which an invite-only installation refuses them.
 * Spec: specs/auth/sign-up-restriction.feature
 */
export function InvitationBeforeOnboarding({ children }: { children: React.ReactNode }) {
  const host = useOnboardingHost();
  const { isPending, inviteCode } = usePendingInvitation();

  useEffect(() => {
    if (!inviteCode) return;
    host.replace(`/invite/accept?inviteCode=${encodeURIComponent(inviteCode)}`);
  }, [inviteCode, host]);

  if (isPending || inviteCode) return <LoadingScreen />;
  return <>{children}</>;
}
