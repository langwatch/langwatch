import { Button, VStack } from "@chakra-ui/react";
import { useCallback, useRef } from "react";
import { AuthCard } from "~/components/auth/AuthCard";
import { LoadingScreen } from "~/components/LoadingScreen";
import { AuthShell, JoinBeforeCreateInterstitial } from "~/features/auth";
import { usePublishAuthStage } from "~/features/auth/logic/groundStage";
import type { JoinableOrganization } from "~/features/auth/logic/joinBeforeCreate";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import { hardRedirect, isNavigatingAway } from "~/utils/hardRedirect";

/** D12's join-before-create decision. This page never creates an organization;
 * only the explicit secondary action enters the workspace-creation flow. */
export default function Join() {
  const { data: session } = useRequiredSession();
  const email = session?.user?.email;

  const lookup = api.joinRequests.lookup.useQuery(void 0, {
    // The session email enables the call but proves nothing. The no-input
    // procedure resolves the caller's verified addresses server-side.
    enabled: !!email,
  });
  const mine = api.joinRequests.mine.useQuery(void 0, { enabled: !!email });
  const askToJoin = api.joinRequests.request.useMutation();
  const admitAutomatically = api.joinRequests.admitAutomatically.useMutation();
  const utils = api.useUtils();

  const continueToWorkspaceCreation = useCallback(() => hardRedirect("/"), []);

  const requestJoin = useCallback(
    (organization: JoinableOrganization) => {
      askToJoin.mutate(
        { organizationId: organization.id },
        {
          onSuccess: () => {
            void utils.joinRequests.mine.invalidate();
          },
          onError: (error) =>
            showErrorToast({
              error,
              fallbackTitle: "Couldn't ask to join",
            }),
        },
      );
    },
    [askToJoin, utils],
  );

  // Rendering may repeat before navigation; admission must not.
  const admitted = useRef(false);
  const admitAndLand = useCallback(() => {
    if (admitted.current) {
      return;
    }
    admitted.current = true;
    admitAutomatically.mutate(
      {},
      {
        onSettled: () => hardRedirect("/"),
      },
    );
  }, [admitAutomatically]);

  if (!email) {
    return <LoadingScreen />;
  }

  // Neither "none" nor "not pending" is known until both reads settle.
  if (lookup.isPending || mine.isPending) {
    return <LoadingScreen />;
  }

  // Hard navigation aborts these reads while the old document still renders.
  if (isNavigatingAway()) {
    return <LoadingScreen />;
  }

  // A failed lookup is not proof that there is nothing to offer.
  if (lookup.isError || mine.isError) {
    return (
      <AuthShell>
        <JoinStage />
        <AuthCard title="We couldn't check for your colleagues">
          <VStack width="full" align="stretch" gap="14px">
            <HandledErrorAlert
              error={lookup.error ?? mine.error}
              fallbackTitle="We couldn't check for your colleagues"
              onRetry={() => {
                if (lookup.isError) void lookup.refetch();
                if (mine.isError) void mine.refetch();
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={continueToWorkspaceCreation}
            >
              Create a new organization instead
            </Button>
          </VStack>
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <JoinStage />
      <JoinBeforeCreateInterstitial
        verifiedEmail={email}
        lookup={lookup.data}
        pendingOrganizationId={mine.data?.[0]?.organizationId ?? null}
        onCreateWorkspace={continueToWorkspaceCreation}
        onJoinOrganization={requestJoin}
        onAlreadyJoined={admitAndLand}
      />
    </AuthShell>
  );
}

/** Publishes sign-up ground even when the interstitial renders no card. */
function JoinStage() {
  usePublishAuthStage({ door: "signup", depth: "settled" });
  return null;
}
