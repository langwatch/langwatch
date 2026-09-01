import { useCallback } from "react";
import { LoadingScreen } from "~/components/LoadingScreen";
import { SetupLayout } from "~/components/SetupLayout";
import { JoinBeforeCreateInterstitial } from "~/features/auth-front-door";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { hardRedirect } from "~/utils/hardRedirect";

/**
 * Join before create (ADR-117 §6): the step a brand-new account passes
 * through before it makes an organization.
 *
 * Today it passes straight through — the interstitial has nothing to offer,
 * renders nothing, and this page sends the person on to create their
 * workspace. D12 fills in which organizations will take an address, and
 * joining becomes the leading action here without any caller changing.
 */
export default function Join() {
  const { data: session } = useRequiredSession();
  const email = session?.user?.email;

  // A hard navigation, for the same reason invitation acceptance uses one:
  // caches primed before the account existed have to go. The destination
  // resolves the right home for an account with no organization yet.
  const continueToWorkspaceCreation = useCallback(() => hardRedirect("/"), []);

  if (!email) return <LoadingScreen />;

  return (
    <SetupLayout>
      <JoinBeforeCreateInterstitial
        verifiedEmail={email}
        onCreateWorkspace={continueToWorkspaceCreation}
        // D12 owns joining, and brings the request it sends with it. Until
        // then no decision reaches this branch, so nothing here can run.
        onJoinOrganization={continueToWorkspaceCreation}
      />
    </SetupLayout>
  );
}
