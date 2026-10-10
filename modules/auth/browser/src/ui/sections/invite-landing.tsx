import { Link } from "@langwatch/browser-host/link";
import { Box, HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { useEffect, useRef, useState } from "react";

import { authApi as api } from "../../behavior/auth-api.ts";
import { signIn, signOut, useSession } from "../../behavior/auth-client.tsx";
import { hardRedirect } from "../../behavior/hard-redirect.ts";
import { usePasskeyCeremony } from "../../behavior/passkey-ceremony.store.ts";
import { useSignInRouting } from "../../behavior/use-sign-in-routing.ts";
import { explainErrorCode } from "../../model/error-presentation.ts";
import { acceptInviteResultSchema } from "../../model/invite-messages.ts";
import { readHandledError } from "../../model/read-handled-error.ts";
import { AuthCard } from "../elements/auth-card.tsx";
import { FrontDoorLinkButton } from "../elements/front-door-link-button.tsx";
import { FrontDoorPrimaryButton } from "../elements/front-door-primary-button.tsx";
import { HandledErrorAlert } from "../elements/handled-error-alert.tsx";
import { InvitingOrganization } from "../elements/inviting-organization.tsx";
import { FRONT_DOOR_LINK_STYLE } from "../elements/secondary-action-link.tsx";
import { PasskeyCeremonyPanel, passkeyCeremonyTitle } from "./passkey-ceremony-panel.tsx";
import { SignInMethodPicker } from "./sign-in-method-picker.tsx";

/** Invitation landing: handles signed-out, signed-in, and expired cases. */
export function InviteLanding({ inviteCode }: { inviteCode: string }) {
  const { data: session } = useSession();
  const landing = api.auth.inviteLanding.useQuery(
    { inviteCode },
    { retry: false, refetchOnWindowFocus: false },
  );

  if (landing.error) {
    return <InviteDeadEnd error={landing.error} inviteCode={inviteCode} />;
  }

  // A card that says it is working, never a blank page. This wait is a
  // network round trip on somebody's first contact with us, and an empty
  // white screen is how a slow connection reads as a broken link.
  if (!landing.data) {
    return (
      <AuthCard title="Invitation">
        <HStack gap={3} justify="center" data-testid="invite-loading">
          <Spinner size="sm" color="frontDoor.detail" />
          <Text color="fg.muted">Looking up your invitation…</Text>
        </HStack>
      </AuthCard>
    );
  }

  return session ? (
    <ConfirmAndJoin
      inviteCode={inviteCode}
      organizationName={landing.data.organizationName}
      inviterName={landing.data.inviterName}
      signedInAs={session.user.email ?? session.user.name ?? null}
    />
  ) : (
    <SignedOutInvite
      inviteCode={inviteCode}
      organizationName={landing.data.organizationName}
      inviterName={landing.data.inviterName}
    />
  );
}

/**
 * An expired invitation is recoverable, so it gets a recovery screen.
 * Everything else stays a quiet dead end on purpose — a refusal that
 * explained itself would let someone learn which organizations exist by guessing codes.
 */
function InviteDeadEnd({ error, inviteCode }: { error: unknown; inviteCode: string }) {
  const code = readHandledError(error)?.code;

  if (code === "invite_expired") {
    return <ExpiredInvite error={error} inviteCode={inviteCode} />;
  }

  return (
    <AuthCard
      title="This invitation is no longer available"
      actions={<FrontDoorLinkButton href="/auth/signin" label="Go to sign in" />}
    >
      <Text color="fg.muted" data-testid="invite-dead-end">
        Ask whoever invited you to send a new one.
      </Text>
    </AuthCard>
  );
}

/**
 * An expired invitation, with the one thing its holder can do: only an admin
 * can mint a new link, so the button asks on their behalf. It never names
 * who was asked — who runs an organization isn't something an expired link should teach.
 */
function ExpiredInvite({ error, inviteCode }: { error: unknown; inviteCode: string }) {
  const ask = api.auth.requestFreshInvite.useMutation();
  // Expiry is the state of the card, so its words are the heading rather than an alert on it.
  const handled = readHandledError(error);
  const copy = handled ? explainErrorCode(handled) : null;

  return (
    <AuthCard title={copy?.title ?? "This invitation has expired"} intro={copy?.description}>
      <VStack width="full" align="stretch" gap={4}>
        {ask.isSuccess ? (
          <>
            <Text data-testid="invite-refresh-asked" color="fg.muted" textAlign="center">
              We let the organization know. A fresh invitation will arrive by email once somebody
              there sends it.
            </Text>
            <FrontDoorLinkButton href="/auth/signin" label="Go to sign in" />
          </>
        ) : (
          <>
            {ask.error ? (
              <HandledErrorAlert
                error={ask.error}
                fallbackTitle="Couldn't ask for a new invitation"
              />
            ) : null}
            <FrontDoorPrimaryButton
              isBusy={ask.isPending}
              testId="invite-ask-again"
              onClick={() => ask.mutate({ inviteCode })}
            >
              Ask for a new invitation
            </FrontDoorPrimaryButton>
          </>
        )}
      </VStack>
    </AuthCard>
  );
}

function SignedOutInvite({
  inviteCode,
  organizationName,
  inviterName,
}: {
  inviteCode: string;
  organizationName: string;
  inviterName: string | null;
}) {
  const routing = useSignInRouting();
  const { decide, decision } = routing;
  const showRoutingRetry = !decision && Boolean(routing.error);
  const asked = useRef(false);
  // A refused passkey ceremony, reported by the rail and drawn once at the top.
  const [passkeyError, setPasskeyError] = useState<unknown>(null);
  // One somebody deliberately started, which takes the card below.
  const ceremony = usePasskeyCeremony();
  const callbackUrl = inviteCallbackUrl(inviteCode);

  // Asked with no address: the invitation names the organization, never the
  // person, so there is no address to route on and the answer is the
  // instance's ordinary method set.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void decide({ identifier: null });
  }, [decide]);

  // This landing draws its rail throughout, so a ceremony takes the card here too.
  if (ceremony) {
    return (
      <AuthCard title={passkeyCeremonyTitle({ ceremony })}>
        <PasskeyCeremonyPanel ceremony={ceremony} />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="You've been invited">
      {/* At the top, like every other failure on these screens: an alert that
          opened part-way down the rail of methods would push the rest of it
          down the page and say its piece where nobody is looking. */}
      <HandledErrorAlert error={routing.error} fallbackTitle="Could not start sign-in" />
      <HandledErrorAlert error={passkeyError} fallbackTitle="Could not use a passkey" />
      <InvitingOrganization
        organizationName={organizationName}
        inviterName={inviterName}
        testId="invite-inviter"
      />
      {decision ? (
        <SignInMethodPicker
          methodSet={decision.methodSet}
          reasonCode={decision.reasonCode}
          callbackUrl={callbackUrl}
          onPasskeyError={setPasskeyError}
          onFederatedMethodChosen={(method) => void signIn(method.id, { callbackUrl })}
          renderLocalMethod={() => (
            <VStack width="full" align="stretch" gap={3}>
              <FrontDoorLinkButton
                href={`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                label="Sign in"
              />
              <FrontDoorLinkButton
                href={`/auth/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                label="Create an account"
                tone="secondary"
              />
            </VStack>
          )}
        />
      ) : null}
      {showRoutingRetry ? (
        // A routing failure used to leave this card empty below the inviter's
        // name — no picker, no retry. The sibling sign-in screen gives the
        // same failure a retry via its address form staying live; there's no
        // form here, so this button is its own retry control.
        <FrontDoorPrimaryButton
          testId="invite-routing-retry"
          isBusy={routing.isDeciding}
          onClick={() => void decide({ identifier: null })}
        >
          Try again
        </FrontDoorPrimaryButton>
      ) : null}
    </AuthCard>
  );
}

function ConfirmAndJoin({
  inviteCode,
  organizationName,
  inviterName,
  signedInAs,
}: {
  inviteCode: string;
  organizationName: string;
  inviterName: string | null;
  /** The account a join would add: its address, or its name when it has none. */
  signedInAs: string | null;
}) {
  const accept = api.invite.acceptInvite.useMutation({
    onSuccess: (data) => {
      // A hard navigation on purpose: caches primed with the pre-invite "no
      // organization" state have to go, or the next page bounces the new
      // member into onboarding.
      const accepted = acceptInviteResultSchema.safeParse(data);
      hardRedirect(
        accepted.success && accepted.data.project?.slug ? `/${accepted.data.project.slug}` : "/",
      );
    },
  });

  // Signed in as somebody else is the one failure with a way out rather than
  // a retry, so it replaces the join button instead of sitting above it.
  const wrongAccount = readHandledError(accept.error)?.code === "invite_wrong_account";

  // Sign out without logout's own redirect, then come back here: the
  // invitation is the thing they were doing.
  const signOutAndReturn = () => {
    void signOut({ redirect: false }).finally(() => {
      hardRedirect(inviteCallbackUrl(inviteCode));
    });
  };

  return (
    <AuthCard
      title="You've been invited"
      finePrint={
        <Box asChild {...FRONT_DOOR_LINK_STYLE} color="fg.muted">
          <Link href="https://docs.langwatch.ai/" target="_blank" rel="noreferrer">
            Read the docs
          </Link>
        </Box>
      }
    >
      <InvitingOrganization
        organizationName={organizationName}
        inviterName={inviterName}
        testId={wrongAccount ? undefined : "invite-confirm"}
      />
      {accept.error ? (
        <HandledErrorAlert error={accept.error} fallbackTitle="Couldn't accept the invitation" />
      ) : null}
      {wrongAccount ? (
        <FrontDoorPrimaryButton testId="invite-switch-account" onClick={signOutAndReturn}>
          Sign out and use that account
        </FrontDoorPrimaryButton>
      ) : (
        <FrontDoorPrimaryButton
          isBusy={accept.isPending}
          onClick={() => accept.mutate({ inviteCode })}
        >
          {`Join ${organizationName}`}
        </FrontDoorPrimaryButton>
      )}
      <Text fontSize="13px" color="fg.muted" textAlign="center">
        {signedInAs ? (
          <>
            Signed in as{" "}
            <Text as="span" color="fg" fontWeight={500} overflowWrap="anywhere">
              {signedInAs}
            </Text>
          </>
        ) : null}
        {signedInAs && !wrongAccount ? " · " : null}
        {wrongAccount ? null : (
          <Box asChild {...FRONT_DOOR_LINK_STYLE} data-testid="invite-sign-out">
            <button type="button" onClick={signOutAndReturn}>
              Use another account
            </button>
          </Box>
        )}
      </Text>
    </AuthCard>
  );
}

/** The invitation rides along untouched: whichever way in is taken returns
 *  here, with the same code. */
function inviteCallbackUrl(inviteCode: string): string {
  return `/invite/accept?inviteCode=${encodeURIComponent(inviteCode)}`;
}
