import { Box, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { AuthCard } from "~/components/auth/AuthCard";
import { HandledErrorAlert, readHandledError } from "~/features/errors";
import { api } from "~/utils/api";
import { signIn, signOut, useSession } from "~/utils/auth-client";
import Link from "~/utils/compat/next-link";
import { hardRedirect } from "~/utils/hardRedirect";
import { useSignInRouting } from "../hooks/useSignInRouting";
import { usePublishAuthStage } from "../logic/groundStage";
import { usePasskeyCeremony } from "../logic/passkeyCeremony";
import { AUTH_PRIMARY_STYLE } from "./AuthPrimaryButton";
import {
  PasskeyCeremonyPanel,
  passkeyCeremonyTitle,
} from "./PasskeyCeremonyPanel";
import { SignInMethodPicker } from "./SignInMethodPicker";

/**
 * The landing's primary action: the auth screens' own button, verbatim.
 *
 * Spread rather than composed because these three sit in a row instead of
 * spanning a column, and `width` is the only value that differs. Everything
 * else — the colour, the cut, the states — comes from the one definition, so
 * the invitation cannot drift away from the log-in it leads to.
 */
const PRIMARY_ACTION = {
  ...AUTH_PRIMARY_STYLE,
  width: "auto",
  minHeight: "40px",
} as const;

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
  const landing = api.auth.inviteLanding.useQuery(
    { inviteCode },
    { retry: false, refetchOnWindowFocus: false },
  );

  // Told once, at the top, from the same state the returns below branch on.
  // A signed-in visitor is one confirmation from being through, so the ground
  // is already most of the way round; everybody else is at a door being asked
  // which way in they want.
  usePublishAuthStage({
    door: "signin",
    depth: session ? "settled" : "entry",
  });

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
          <Spinner size="sm" color="auth.detail" />
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
  const ask = api.auth.requestFreshInvite.useMutation();

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
                {...PRIMARY_ACTION}
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

  // A ceremony in flight takes the card here too, exactly as it does on both
  // doors. This landing was the one surface that kept drawing its live rail
  // underneath a system sheet — so the browser had the screen, the prompt may
  // have opened on another device, and the only thing saying so was three
  // buttons that had gone quiet. Worse, a ceremony that neither resolves nor
  // rejects left that rail unusable with nothing on screen to explain it or
  // cancel it. The panel says what is being waited on and offers both ways
  // out, which is the whole reason it exists.
  if (ceremony) {
    return (
      <AuthCard title={passkeyCeremonyTitle(ceremony)}>
        <PasskeyCeremonyPanel ceremony={ceremony} />
      </AuthCard>
    );
  }

  return (
    <AuthCard title={`Join ${organizationName}`}>
      {/* At the top, like every other failure on these screens: an alert that
          opened part-way down the rail of methods would push the rest of it
          down the page and say its piece where nobody is looking. */}
      <HandledErrorAlert
        error={passkeyError}
        fallbackTitle="Could not use a passkey"
        className="lw-auth-alert"
      />
      <Text data-testid="invite-inviter">
        {inviterName
          ? `${inviterName} invited you to ${organizationName} on LangWatch.`
          : `You have been invited to ${organizationName} on LangWatch.`}
      </Text>
      {/* A ROUTING FAILURE IS NOT AN EMPTY METHOD SET. Rendering null on a
          null decision left the invitee looking at "X invited you to Y" with
          no way in at all — no methods, no create-account link (that lives
          inside the picker), no error and no retry — until they reloaded and
          got lucky. The endpoint is rate limited per IP, so a shared office
          network reaches this without anything being down. */}
      <HandledErrorAlert
        error={routing.error}
        fallbackTitle="Couldn't load your sign-in options"
        className="lw-auth-alert"
      />
      {routing.decision ? (
        <SignInMethodPicker
          methodSet={routing.decision.methodSet}
          reasonCode={routing.decision.reasonCode}
          callbackUrl={callbackUrl}
          onPasskeyError={setPasskeyError}
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
      ) : routing.isDeciding ? null : (
        // Neither an answer nor an error yet, or an answer that never came:
        // the two links the picker would have drawn are the way on, so the
        // invitation is never a dead end.
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
              {...PRIMARY_ACTION}
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
              {...PRIMARY_ACTION}
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
