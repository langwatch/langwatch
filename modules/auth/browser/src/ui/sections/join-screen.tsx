import { Button, VStack } from "@chakra-ui/react";
import { LoadingScreen } from "@langwatch/design-system/loading-screen";

import { isNavigatingAway } from "../../behavior/hard-redirect.ts";
import { useJoinBeforeCreate } from "../../behavior/use-join-before-create.ts";
import { useRequiredSession } from "../../behavior/use-required-session.ts";
import { JoinBeforeCreateInterstitial } from "../../ui/blocks/join-before-create-interstitial.tsx";
import { SetupLayout } from "../../ui/sections/setup-layout.tsx";
import { AuthCard } from "../elements/auth-card.tsx";
import { HandledErrorAlert } from "../elements/handled-error-alert.tsx";

/**
 * D12's join-before-create decision. This screen never creates an
 * organization; only the explicit secondary action enters that flow.
 * Spec: specs/identity/join-before-create.feature.
 */
export default function Join() {
  const { data: session } = useRequiredSession();
  const email = session?.user?.email;
  const join = useJoinBeforeCreate({ enabled: !!email });
  const { lookup, mine } = join;

  if (!email) return <LoadingScreen />;
  // Neither "none" nor "not pending" is known until both reads settle.
  if (lookup.isPending || mine.isPending) return <LoadingScreen />;
  // Hard navigation aborts these reads while the old document still renders.
  if (isNavigatingAway()) return <LoadingScreen />;

  // A failed lookup is not proof that there is nothing to offer.
  if (lookup.isError || mine.isError) {
    return (
      <SetupLayout>
        <AuthCard title="We couldn't check for your colleagues">
          <VStack width="full" align="stretch" gap="14px" data-testid="join-lookup-failed">
            <HandledErrorAlert
              error={lookup.error ?? mine.error}
              fallbackTitle="We couldn't check for your colleagues"
            />
            <Button
              variant="outline"
              onClick={() => {
                if (lookup.isError) void lookup.refetch();
                if (mine.isError) void mine.refetch();
              }}
            >
              Try again
            </Button>
            <Button variant="ghost" size="sm" onClick={join.continueToWorkspaceCreation}>
              Create a new organization instead
            </Button>
          </VStack>
        </AuthCard>
      </SetupLayout>
    );
  }

  return (
    <SetupLayout>
      <JoinBeforeCreateInterstitial
        verifiedEmail={email}
        lookup={lookup.data}
        pendingOrganizationId={mine.data?.[0]?.organizationId ?? null}
        onCreateWorkspace={join.continueToWorkspaceCreation}
        onJoinOrganization={join.requestJoin}
        onAlreadyJoined={join.admitAndLand}
      />
      <HandledErrorAlert error={join.requestError} fallbackTitle="Couldn't ask to join" />
    </SetupLayout>
  );
}
