import { useCallback, useRef } from "react";
import { LoadingScreen } from "~/components/LoadingScreen";
import { AuthShell, JoinBeforeCreateInterstitial } from "~/features/auth";
import { usePublishAuthStage } from "~/features/auth/logic/groundStage";
import type { JoinableOrganization } from "~/features/auth/logic/joinBeforeCreate";
import { showErrorToast } from "~/features/errors";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import { hardRedirect } from "~/utils/hardRedirect";

/**
 * Join before create (ADR-117 §6, D12): the step a brand-new account passes
 * through before it makes an organization.
 *
 * The invariant that gives the deliverable its second name is enforced by
 * what this page does NOT do: it creates nothing. Every path out of here is
 * either a click on "join" — which asks, and leaves the person in no
 * organization while the request is open — or a click on "create a new
 * organization", which hands over to the workspace-creation flow that has
 * always owned that. Nothing is minted on the way past.
 *
 * Three server answers reach it: nothing to offer (render nothing, carry on),
 * an organization that admits this address automatically (admit them, then
 * land them inside), and organizations open to a request (offer them, join
 * leading).
 */
export default function Join() {
  const { data: session } = useRequiredSession();
  const email = session?.user?.email;

  const lookup = api.joinRequests.lookup.useQuery(void 0, {
    // Nothing is looked up before there is a session to look up FOR. The
    // procedure itself answers only for the caller's own verified addresses,
    // so an unverified one gets the universal nothing rather than a name.
    enabled: !!email,
  });
  const mine = api.joinRequests.mine.useQuery(void 0, { enabled: !!email });
  const askToJoin = api.joinRequests.request.useMutation();
  const admitAutomatically = api.joinRequests.admitAutomatically.useMutation();
  const utils = api.useUtils();

  // A hard navigation, for the same reason invitation acceptance uses one:
  // caches primed before the account existed have to go. The destination
  // resolves the right home for an account with no organization yet.
  const continueToWorkspaceCreation = useCallback(() => hardRedirect("/"), []);

  const requestJoin = useCallback(
    (organization: JoinableOrganization) => {
      askToJoin.mutate(
        { organizationId: organization.id },
        {
          onSuccess: () => {
            // The waiting screen, from the same query the interstitial reads.
            // No organization has been created and none will be until this
            // person explicitly asks for one.
            void utils.joinRequests.mine.invalidate();
          },
          // Never `error.message`: the code-keyed registry owns the words.
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

  // Fired once. The mutation is idempotent at the aggregate — a retried
  // approval is the same derived command — but asking twice would still cost
  // a round trip on every re-render of a screen that is about to navigate.
  const admitted = useRef(false);
  const admitAndLand = useCallback(() => {
    if (admitted.current) return;
    admitted.current = true;
    admitAutomatically.mutate(
      {},
      {
        // Either way the person carries on: a membership that landed sends
        // them to it, and one that did not leaves them where sign-up would
        // have taken them anyway. Neither creates anything.
        onSettled: () => hardRedirect("/"),
      },
    );
  }, [admitAutomatically]);

  if (!email) return <LoadingScreen />;

  // The last step of sign-up, so it is still sign-up's ground. This page was
  // the setup layout — a grey field and a plain panel with a sign-out button
  // pinned to the corner — which put a change of surface between confirming an
  // address and choosing where to put it, in the middle of one continuous
  // journey. The page is reached with a session, so the auth screens' flag has
  // nothing to decide here: whoever is looking at it is already through.
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

/**
 * Where the ground is, said from a component of its own.
 *
 * The interstitial renders nothing at all in two of its four outcomes, so it
 * cannot be the thing that publishes: a hook has to run unconditionally, and
 * the step that says "carry on to workspace creation" is drawing no card for
 * the ground to sit behind.
 */
function JoinStage() {
  usePublishAuthStage({ door: "signup", depth: "settled" });
  return null;
}
