import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import { AuthCard } from "~/components/auth/AuthCard";
import { HandledErrorAlert, readHandledError } from "~/features/errors";
import { api } from "~/utils/api";
import { signIn, useSession } from "~/utils/auth-client";
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

  if (landing.isLoading) return null;

  if (landing.error) {
    return <InviteDeadEnd error={landing.error} />;
  }

  if (!landing.data) return null;

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
 * An expired invitation is recoverable, so it says so and names the way: the
 * registry copy for `invite_expired` asks the inviter for a fresh one.
 * Everything else is the quiet dead end, which describes nothing on purpose.
 */
function InviteDeadEnd({ error }: { error: unknown }) {
  const code = readHandledError(error)?.code;

  if (code === "invite_expired") {
    return (
      <AuthCard title="Invitation">
        <HandledErrorAlert
          error={error}
          fallbackTitle="This invitation has expired"
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Invitation">
      <Text data-testid="invite-dead-end">
        This invitation is no longer available.
      </Text>
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

  return (
    <AuthCard title={`Join ${organizationName}`}>
      <VStack width="full" align="stretch" gap={4}>
        <Text data-testid="invite-confirm">
          You have been invited to {organizationName}. Joining adds your account
          to it.
        </Text>
        {accept.error ? (
          <HandledErrorAlert
            error={accept.error}
            fallbackTitle="Couldn't accept the invitation"
          />
        ) : null}
        <HStack>
          <Button
            colorPalette="orange"
            loading={accept.isPending}
            onClick={() => accept.mutate({ inviteCode })}
          >
            Join {organizationName}
          </Button>
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
