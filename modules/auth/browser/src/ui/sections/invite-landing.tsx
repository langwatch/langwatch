import { Box, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";

import { authApi as api } from "../../behavior/auth-api.ts";
import { signIn, signOut, useSession } from "../../behavior/auth-client.tsx";
import { hardRedirect } from "../../behavior/hard-redirect.ts";
import { useSignInRouting } from "../../behavior/use-sign-in-routing.ts";
import { acceptInviteResultSchema } from "../../model/accept-invite-result.ts";
import { readHandledError } from "../../model/read-handled-error.ts";
import { AuthCard } from "../elements/auth-card.tsx";
import { HandledErrorAlert } from "../elements/handled-error-alert.tsx";
import Link from "../elements/router-link.tsx";
import { SignInMethodPicker } from "./sign-in-method-picker.tsx";

/** Invitation landing: handles signed-out, signed-in, and expired cases. */
export function InviteLanding({ inviteCode }: { inviteCode: string }) {
  const { data: session } = useSession();
  const landing = api.frontDoor.inviteLanding.useQuery(
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
        <HStack gap={3} data-testid="invite-loading">
          <Spinner size="sm" color="orange.500" />
          <Text color="fg.muted">Looking up your invitation…</Text>
        </HStack>
      </AuthCard>
    );
  }

  return session ? (
    <ConfirmAndJoin inviteCode={inviteCode} organizationName={landing.data.organizationName} />
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
    <AuthCard title="Invitation">
      <Text data-testid="invite-dead-end">This invitation is no longer available.</Text>
    </AuthCard>
  );
}

/**
 * An expired invitation, with the one thing its holder can do: only an admin
 * can mint a new link, so the button asks on their behalf. It never names
 * who was asked — who runs an organization isn't something an expired link should teach.
 */
function ExpiredInvite({ error, inviteCode }: { error: unknown; inviteCode: string }) {
  const ask = api.frontDoor.requestFreshInvite.useMutation();

  return (
    <AuthCard title="Invitation">
      <VStack width="full" align="stretch" gap={4}>
        <HandledErrorAlert error={error} fallbackTitle="This invitation has expired" />
        {ask.isSuccess ? (
          <Text data-testid="invite-refresh-asked" color="fg.muted">
            We let the organization know. You will get a fresh invitation by email once somebody
            there sends it.
          </Text>
        ) : (
          <>
            {ask.error ? (
              <HandledErrorAlert
                error={ask.error}
                fallbackTitle="Couldn't ask for a new invitation"
              />
            ) : null}
            <HStack>
              <Button
                colorPalette="orange"
                loading={ask.isPending}
                data-testid="invite-ask-again"
                onClick={() => ask.mutate({ inviteCode })}
              >
                Ask for a new invitation
              </Button>
            </HStack>
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
  const callbackUrl = inviteCallbackUrl(inviteCode);

  // Asked with no address: the invitation names the organization, never the
  // person, so there is no address to route on and the answer is the
  // instance's ordinary method set.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void decide({ identifier: null });
  }, [decide]);

  return (
    <AuthCard title={`Join ${organizationName}`}>
      {/* At the top, like every other failure on these screens: an alert that
          opened part-way down the rail of methods would push the rest of it
          down the page and say its piece where nobody is looking. */}
      <HandledErrorAlert
        error={routing.error}
        fallbackTitle="Could not start sign-in"
        className="lw-front-door-alert"
      />
      <HandledErrorAlert
        error={passkeyError}
        fallbackTitle="Could not use a passkey"
        className="lw-front-door-alert"
      />
      <Text data-testid="invite-inviter">
        {inviterName
          ? `${inviterName} invited you to ${organizationName} on LangWatch.`
          : `You have been invited to ${organizationName} on LangWatch.`}
      </Text>
      {decision ? (
        <SignInMethodPicker
          methodSet={decision.methodSet}
          reasonCode={decision.reasonCode}
          callbackUrl={callbackUrl}
          onPasskeyError={setPasskeyError}
          onFederatedMethodChosen={(method) => void signIn(method.id, { callbackUrl })}
          renderLocalMethod={() => (
            <HStack gap={4}>
              <Box asChild>
                <Link
                  href={`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                  style={{ textDecoration: "underline" }}
                >
                  Sign in
                </Link>
              </Box>
              <Box asChild>
                <Link
                  href={`/auth/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}
                  style={{ textDecoration: "underline" }}
                >
                  Create an account
                </Link>
              </Box>
            </HStack>
          )}
        />
      ) : null}
      {showRoutingRetry ? (
        // A routing failure used to leave this card empty below the inviter's
        // name — no picker, no retry. The sibling sign-in screen gives the
        // same failure a retry via its address form staying live; there's no
        // form here, so this button is its own retry control.
        <HStack>
          <Button
            colorPalette="orange"
            data-testid="invite-routing-retry"
            loading={routing.isDeciding}
            onClick={() => void decide({ identifier: null })}
          >
            Try again
          </Button>
        </HStack>
      ) : null}
    </AuthCard>
  );
}

function ConfirmAndJoin({
  inviteCode,
  organizationName,
}: {
  inviteCode: string;
  organizationName: string;
}) {
  const accept = api.organization.acceptInvite.useMutation({
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
  // a retry, so it replaces the join button instead of sitting above it:
  // clicking Join again would fail the same way every time.
  const wrongAccount = readHandledError(accept.error)?.code === "invite_wrong_account";

  return (
    <AuthCard title={`Join ${organizationName}`}>
      <VStack width="full" align="stretch" gap={4}>
        {wrongAccount ? null : (
          <Text data-testid="invite-confirm">
            You have been invited to {organizationName}. Joining adds your account to it.
          </Text>
        )}
        {accept.error ? (
          <HandledErrorAlert error={accept.error} fallbackTitle="Couldn't accept the invitation" />
        ) : null}
        <HStack>
          {wrongAccount ? (
            <Button
              colorPalette="orange"
              data-testid="invite-switch-account"
              onClick={() => {
                // Sign out without the endpoint's own redirect, then come
                // back here: the invitation is the thing they were doing,
                // and logout's default lands on a bare sign-in page that has
                // forgotten all about it.
                void signOut({ redirect: false }).finally(() => {
                  hardRedirect(inviteCallbackUrl(inviteCode));
                });
              }}
            >
              Sign out and use that account
            </Button>
          ) : (
            <Button
              colorPalette="orange"
              loading={accept.isPending}
              onClick={() => accept.mutate({ inviteCode })}
            >
              Join {organizationName}
            </Button>
          )}
        </HStack>
      </VStack>
    </AuthCard>
  );
}

/** The invitation rides along untouched: whichever way in is taken returns
 *  here, with the same code. */
function inviteCallbackUrl(inviteCode: string): string {
  return `/invite/accept?inviteCode=${encodeURIComponent(inviteCode)}`;
}
