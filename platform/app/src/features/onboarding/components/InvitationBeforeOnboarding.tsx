import type React from "react";
import { useEffect } from "react";
import { LoadingScreen } from "~/components/LoadingScreen";
import { useRouter } from "~/utils/compat/next-router";
import { usePendingInvitation } from "../hooks/use-pending-invitation";

/**
 * Sends somebody holding a pending invitation to it before the screen that
 * creates an organization is shown.
 *
 * On an installation where accounts are created by invitation, a person who
 * signed up from the sign-in screen rather than the invitation link belongs
 * to no organization yet and is refused the creation of one. Their invitation
 * is where they need to be.
 *
 * Spec: specs/auth/sign-up-restriction.feature
 */
export function InvitationBeforeOnboarding({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isPending, inviteCode } = usePendingInvitation();

  useEffect(() => {
    if (!inviteCode) return;
    void router.replace(
      `/invite/accept?inviteCode=${encodeURIComponent(inviteCode)}`,
    );
  }, [inviteCode, router]);

  if (isPending || inviteCode) return <LoadingScreen />;
  return <>{children}</>;
}
