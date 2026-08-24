import { Box, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import { AuthCard } from "~/components/auth/AuthCard";
import { HandledErrorAlert, readHandledError } from "~/features/errors";
import { api } from "~/utils/api";
import { signIn, signOut, useSession } from "~/utils/auth-client";
import Link from "~/utils/compat/next-link";
import { hardRedirect } from "~/utils/hardRedirect";
import { useSignInRouting } from "../hooks/useSignInRouting";
import { SignInMethodPicker } from "./SignInMethodPicker";

/**
 * The invitation landing (D13, ADR-117 §6; the rules underneath are D11's).
 *
 * Three journeys, one screen. Signed out, it says who is asking and offers
 * every way in, carrying the invitation through whichever one is taken.
 * Signed in, it asks before it acts: an invitation is a membership, and one
 * should not appear because a link was opened. Expired, it points at the one
 * person who can fix it in a click.
 *
 * A revoked invitation and one that never existed end the same way, quietly.
 * That is D11's rule and it is deliberate: an invitation code is guessable
 * material, and a dead end that describes what it did not find is a way to
 * learn which organizations exist.
 */
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
    <ConfirmAndJoin
      inviteCode={inviteCode}
      organizationName={landing.data.organizationName}
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
 * An expired invitation is recoverable, so it gets the screen that recovers
 * it. Everything else is the quiet dead end, which describes nothing on
 * purpose — a refusal that explained itself would be a way to learn which
 * organizations exist by guessing at codes.
 */
function InviteDeadEnd({
  error,
  inviteCode,
}: {
  error: unknown;
  inviteCode: string;
}) {
  const code = readHandledError(error)?.code;

  if (code === "invite_expired") {
    return <ExpiredInvite error={error} inviteCode={inviteCode} />;
  }

  return (
    <AuthCard title="Invitation">
      <Text data-testid="invite-dead-end">
        This invitation is no longer available.
      </Text>
    </AuthCard>
  );
}

/**
 * An expired invitation, with the one thing its holder can actually do.
 *
 * They cannot mint themselves a new link — only an admin can, and that is
 * what keeps expiry meaningful — so the button asks on their behalf and the
 * screen then says so. It deliberately never names who was asked: who runs
 * an organization is not something an expired link should teach.
 */
function ExpiredInvite({
  error,
  inviteCode,
}: {
  error: unknown;
  inviteCode: string;
}) {
  const ask = api.frontDoor.requestFreshInvite.useMutation();

  return (
    <AuthCard title="Invitation">
      <VStack width="full" align="stretch" gap={4}>
        <HandledErrorAlert
          error={error}
          fallbackTitle="This invitation has expired"
        />
        {ask.isSuccess ? (
          <Text data-testid="invite-refresh-asked" color="fg.muted">
            We let the organization know. You will get a fresh invitation by
            email once somebody there sends it.
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
  const { decide } = routing;
  const asked = useRef(false);
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
      <Text data-testid="invite-inviter">
        {inviterName
          ? `${inviterName} invited you to ${organizationName} on LangWatch.`
          : `You have been invited to ${organizationName} on LangWatch.`}
      </Text>
      {routing.decision ? (
        <SignInMethodPicker
          methodSet={routing.decision.methodSet}
          reasonCode={routing.decision.reasonCode}
          onFederatedMethodChosen={(method) =>
            void signIn(method.id, { callbackUrl })
          }
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
      hardRedirect(data.project?.slug ? `/${data.project.slug}` : "/");
    },
  });

  // Signed in as somebody else is the one failure with a way out rather than
  // a retry, so it replaces the join button instead of sitting above it:
  // clicking Join again would fail the same way every time.
  const wrongAccount =
    readHandledError(accept.error)?.code === "invite_wrong_account";

  return (
    <AuthCard title={`Join ${organizationName}`}>
      <VStack width="full" align="stretch" gap={4}>
        {wrongAccount ? null : (
          <Text data-testid="invite-confirm">
            You have been invited to {organizationName}. Joining adds your
            account to it.
          </Text>
        )}
        {accept.error ? (
          <HandledErrorAlert
            error={accept.error}
            fallbackTitle="Couldn't accept the invitation"
          />
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
