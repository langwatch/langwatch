import { LoadingScreen } from "@langwatch/design-system/loading-screen";
import { useCallback } from "react";

import { hardRedirect } from "../../behavior/hard-redirect.ts";
import { useRequiredSession } from "../../behavior/use-required-session.ts";
import { JoinBeforeCreateInterstitial } from "../../ui/blocks/join-before-create-interstitial.tsx";
import { SetupLayout } from "../../ui/sections/setup-layout.tsx";

/** Step before workspace creation; interstitial offers join or create path. */
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
