import { Box, Button, Text, VStack } from "@chakra-ui/react";
import type { JoinLookupDecision } from "@langwatch/identity";
import { AuthCard } from "~/components/auth/AuthCard";
import { Dialog } from "~/components/ui/dialog";
import { AuthPrimaryButton } from "~/features/auth/components/AuthPrimaryButton";
import { AUTH_SECONDARY_STYLE } from "~/features/auth/components/AuthSecondaryButton";
import { AuthShell } from "~/features/auth/components/AuthShell";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import { signOut, useSession } from "~/utils/auth-client";

/**
 * Presents the join decision and any pending request for the active account.
 *
 * `currentOrganizationId` carries three distinct meanings, not two: a string
 * scopes a pending request to that organization; explicit `null` means the
 * caller has no organization context at all (onboarding, where a request
 * still blocks workspace creation); `undefined` means the caller HAS a
 * context but it has not resolved yet (a dashboard's own organization read,
 * still in flight). That third state must never be read as "no context" —
 * doing so is what let a pending request for a DIFFERENT organization take
 * over a dashboard while its own organization was still loading.
 */
export function JoinYourTeamTakeover({
  dismissLabel = "Not now — keep working on my own",
  onDismissed,
  fallback = null,
  currentOrganizationId,
}: {
  /** What the way past is called where "keep working on my own" is not what
   *  declining means. On the onboarding path it means "carry on and make an
   *  organization", which is the sentence that screen should say. */
  dismissLabel?: string;
  /** Called once the refusal has landed, for a caller that has somewhere to
   *  send them. Absent on the dashboard, where declining just closes it. */
  onDismissed?: () => void;
  /** A lower-priority prompt, shown only after the join decision resolves. */
  fallback?: React.ReactNode;
  /**
   * The organization currently being viewed — `string` to scope to it,
   * explicit `null` for "no organization context at all" (onboarding), or
   * `undefined` for "there is a context, but it has not resolved yet".
   * Every caller must pick one deliberately, so the prop is required: an
   * omission is a type error, not a silent "not resolved yet".
   */
  currentOrganizationId: string | null | undefined;
}) {
  // The shell renders on public pages too (a shared trace), where there is no
  // session to ask about — and a protected query fired there is a refusal
  // nobody asked for.
  const { data: session } = useSession();
  const enabled = !!session?.user;

  const offer = api.joinRequests.offer.useQuery(void 0, { enabled });
  const mine = api.joinRequests.mine.useQuery(void 0, { enabled });
  const dismiss = api.joinRequests.dismissOffer.useMutation();
  const askToJoin = api.joinRequests.request.useMutation();
  const utils = api.useUtils();

  // Nothing is decided until BOTH answers are in. Rendering the offer while
  // the pending query is still in flight would show "ask to join" to somebody
  // who already asked — the same class of mistake that made the old button
  // look inert.
  if (offer.isPending || mine.isPending) return null;

  const decision = offer.data;

  // The dashboard's OWN organization read is still in flight — a distinct
  // state from "no organization context" (onboarding passes explicit
  // `null` for that). Deciding "no context" here is exactly what let a
  // pending request for some OTHER organization take over a dashboard
  // whose own organization had not resolved yet: the read is half
  // answered, so nothing here decides.
  if (currentOrganizationId === undefined) return fallback;

  const waiting = findWaitingRequest(mine.data, currentOrganizationId);

  if (waiting) {
    return (
      <WaitingForAnAdministrator
        organizationName={organizationNameFor({ decision, waiting })}
        onCheckAgain={() => void utils.joinRequests.mine.invalidate()}
      />
    );
  }

  // A dashboard already has an organization context. Do not replace it with
  // a domain offer for another organization; onboarding has no such context
  // and keeps the offer visible. `undefined` cannot reach here (returned
  // above), so this is `null` (no context) versus a real organization id.
  if (
    currentOrganizationId !== null &&
    decision?.outcome === "ask" &&
    !decision.organizations.some(
      (organization) => organization.organizationId === currentOrganizationId,
    )
  ) {
    return fallback;
  }

  if (!decision || decision.outcome === "none") return fallback;
  // An automatic match is not an offer to weigh — the arrival admits them.
  if (decision.outcome === "auto") return fallback;
  if (decision.organizations.length === 0) return fallback;

  const refuse = () =>
    dismiss.mutate(
      {},
      {
        onSuccess: () => {
          void utils.joinRequests.offer.invalidate();
          onDismissed?.();
        },
        // Never `error.message`: the code-keyed registry owns the words.
        onError: (error) =>
          showErrorToast({ error, fallbackTitle: "Couldn't save that" }),
      },
    );

  const ask = (organizationId: string) =>
    askToJoin.mutate(
      { organizationId },
      {
        onSuccess: () => {
          // Straight to the waiting half, from the same queries that drew
          // this one. Nothing navigates and nothing is created.
          void utils.joinRequests.mine.invalidate();
          void utils.joinRequests.offer.invalidate();
        },
        onError: (error) =>
          showErrorToast({ error, fallbackTitle: "Couldn't ask to join" }),
      },
    );

  return (
    <Takeover
      title="Your colleagues are already here"
      intro="Join them instead of building in a workspace of your own."
      testId="join-team-takeover"
    >
      {decision.organizations.map((organization) => (
        // Joining LEADS. Creating your own is what happens if you decline,
        // and it is already what you have — so it needs no button here.
        <AuthPrimaryButton
          key={organization.organizationId}
          isBusy={askToJoin.isPending}
          onClick={() => ask(organization.organizationId)}
        >
          Ask to join {organization.name}
        </AuthPrimaryButton>
      ))}
      <SecondaryAction loading={dismiss.isPending} onClick={refuse}>
        {dismissLabel}
      </SecondaryAction>
      <Text fontSize="12.5px" color="fg.subtle" textAlign="center">
        We will not ask about this domain again.
      </Text>
    </Takeover>
  );
}

/**
 * The screen itself: a modal that cannot be dismissed by clicking past it.
 *
 * Not because the answer is compulsory — "not now" is right there — but
 * because a click on the backdrop is not an answer, and treating it as one is
 * how a person ends up asked again tomorrow having believed they had decided.
 */
function Takeover({
  title,
  intro,
  testId,
  children,
}: {
  title: string;
  intro?: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root
      open
      size="cover"
      placement="center"
      closeOnInteractOutside={false}
      closeOnEscape={false}
      // Nothing to call: the screen closes by being answered.
      onOpenChange={() => void 0}
    >
      <Dialog.Content data-testid={testId} bg="bg" borderRadius={0}>
        <Dialog.Body
          display="flex"
          alignItems="center"
          justifyContent="center"
          padding={6}
        >
          <VStack width="full" maxWidth="420px" align="stretch" gap="18px">
            <Box>
              <Dialog.Title
                fontSize="22px"
                fontWeight={600}
                letterSpacing="-0.01em"
                textAlign="center"
              >
                {title}
              </Dialog.Title>
              {intro !== undefined && (
                <Text
                  fontSize="14px"
                  color="fg.muted"
                  textAlign="center"
                  paddingTop="6px"
                >
                  {intro}
                </Text>
              )}
            </Box>
            {children}
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** The way past, available and never the loud one. */
function SecondaryAction({
  onClick,
  loading,
  children,
}: {
  onClick: () => void;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="outline"
      width="full"
      minHeight="44px"
      fontSize="14px"
      fontWeight={600}
      loading={loading}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/**
 * The name of the organization somebody is waiting on, when we know it.
 *
 * `null` rather than a guess: the offer that named the organizations is a
 * separate query from the request itself, so it may be absent or may no longer
 * carry the one they asked about. The waiting screen reads better without a
 * name than with the wrong one.
 */
function organizationNameFor({
  decision,
  waiting,
}: {
  decision: JoinLookupDecision | undefined;
  waiting: { organizationId: string };
}): string | null {
  if (decision?.outcome !== "ask") return null;
  return (
    decision.organizations?.find(
      (organization) => organization.organizationId === waiting.organizationId,
    )?.name ?? null
  );
}

/**
 * `currentOrganizationId` is never `undefined` here — the caller above
 * already returned `fallback` for that state. Only `null` (no organization
 * context at all, onboarding) matches any pending request; a string matches
 * only that organization's.
 */
function findWaitingRequest(
  requests: Array<{ organizationId: string }> | undefined,
  currentOrganizationId: string | null,
) {
  return (
    requests?.find(
      (request) =>
        currentOrganizationId === null ||
        request.organizationId === currentOrganizationId,
    ) ?? null
  );
}

/**
 * THE WAITING HALF. Asking is not joining: an administrator has to say yes.
 *
 * Somebody who has asked sees this rather than a dashboard that looks like
 * nothing happened — which is the moment people ask again, or give up and make
 * the second workspace this screen exists to prevent.
 */
function WaitingForAnAdministrator({
  organizationName,
  onCheckAgain,
}: {
  organizationName: string | null;
  onCheckAgain: () => void;
}) {
  return (
    <Dialog.Root
      open
      size="full"
      closeOnEscape={false}
      closeOnInteractOutside={false}
    >
      <Dialog.Content
        aria-label="Waiting for an administrator"
        data-testid="join-team-waiting"
        padding={0}
        borderRadius={0}
        borderWidth={0}
        minHeight="100dvh"
        positionerProps={{ padding: 0 }}
      >
        <AuthShell fillContainer>
          <AuthCard title="Waiting for an administrator" solid>
            <Text fontSize="14px" lineHeight="1.65" color="fg.muted">
              {organizationName === null
                ? "Your request to join is with the administrators."
                : `Your request to join ${organizationName} is with their administrators.`}{" "}
              We will email you as soon as somebody answers, either way.
            </Text>
            <AuthPrimaryButton onClick={onCheckAgain}>
              Check again
            </AuthPrimaryButton>
            <Button {...AUTH_SECONDARY_STYLE} onClick={() => void signOut()}>
              Sign out
            </Button>
          </AuthCard>
        </AuthShell>
      </Dialog.Content>
    </Dialog.Root>
  );
}
