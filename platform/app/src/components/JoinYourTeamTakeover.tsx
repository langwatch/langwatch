import { Box, Button, Text, VStack } from "@chakra-ui/react";
import type {
  JoinLookupDecision,
  JoinRequestOrigin,
} from "@langwatch/identity";
import { useEffect, useRef, useState } from "react";
import { AuthCard } from "~/components/auth/AuthCard";
import { orgRoleOptions } from "~/components/settings/OrganizationUserRoleField";
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
  origin = "web",
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
  /**
   * Where a request made from here is coming from (ADR-143 v6). The welcome
   * screen passes `cli` when `langwatch login`'s device-approval page sent
   * the person here; a `cli` request lands a Developer seat whatever the
   * organization's joiner seat says. Everything else is `web`.
   */
  origin?: JoinRequestOrigin;
}) {
  const {
    settled,
    decision,
    mine,
    invitation,
    askHeldDown,
    setInvitationAside,
    admitting,
  } = useJoinTakeoverState({ currentOrganizationId, origin });
  const utils = api.useUtils();

  // Nothing is decided until EVERY answer is in. Rendering the offer while
  // the pending query is still in flight would show "ask to join" to somebody
  // who already asked — the same class of mistake that made the old button
  // look inert.
  if (!settled) return null;

  // The dashboard's OWN organization read is still in flight — a distinct
  // state from "no organization context" (onboarding passes explicit
  // `null` for that). Deciding "no context" here is exactly what let a
  // pending request for some OTHER organization take over a dashboard
  // whose own organization had not resolved yet: the read is half
  // answered, so nothing here decides.
  if (currentOrganizationId === undefined) return fallback;

  // An administrator already answered the question this screen would ask,
  // by inviting them. Lead with that, and offer no ask beside it. It leads
  // even over a request already waiting: accepting withdraws that request,
  // while waiting on it would let an approval land the joiner seat instead
  // of the seat the administrator chose. Only the welcome screen is handed
  // an invitation (see the state hook), so a dashboard is unchanged.
  if (invitation) {
    return (
      <InvitationTakeover
        invitation={invitation}
        dismissLabel={dismissLabel}
        onSetAside={setInvitationAside}
      />
    );
  }

  const waiting = findWaitingRequest(mine, currentOrganizationId);

  if (waiting) {
    return (
      <WaitingForAnAdministrator
        organizationName={organizationNameFor({ decision, waiting })}
        onCheckAgain={() => void utils.joinRequests.mine.invalidate()}
      />
    );
  }

  if (!decision || decision.outcome === "none") return fallback;

  // An automatic match is not an offer to weigh — the arrival admits them.
  // On the welcome screen that admission is running now (above); a dashboard
  // leaves it to the sign-up path and shows nothing.
  if (decision.outcome === "auto") {
    return admitting ? (
      <AdmittingTakeover organizationName={decision.organization.name} />
    ) : (
      fallback
    );
  }

  if (
    offerIsNotForHere({
      decision,
      currentOrganizationId,
      askHeldDown,
    })
  )
    return fallback;

  return (
    <AskToJoinTakeover
      organizations={decision.organizations}
      origin={origin}
      dismissLabel={dismissLabel}
      onDismissed={onDismissed}
    />
  );
}

/**
 * The three answers the takeover waits on, and the one side effect it runs.
 *
 * The shell renders on public pages too (a shared trace), where there is no
 * session to ask about — and a protected query fired there is a refusal nobody
 * asked for, so nothing is asked without one. Two behaviours belong only to the
 * welcome screen: leading with a pending invitation, and walking through an
 * automatic door. A dashboard has an organization in view, and covering it
 * with an invitation, or quietly adding its member to another organization,
 * would be wrong there — so both are keyed on `onboarding`.
 */
function useJoinTakeoverState({
  currentOrganizationId,
  origin,
}: {
  currentOrganizationId: string | null | undefined;
  origin: JoinRequestOrigin;
}) {
  const { data: session } = useSession();
  const enabled = !!session?.user;
  const onboarding = currentOrganizationId === null;

  const offer = api.joinRequests.offer.useQuery(void 0, { enabled });
  const mine = api.joinRequests.mine.useQuery(void 0, { enabled });
  const invitations = api.invite.pendingForMe.useQuery(
    {},
    { enabled: enabled && onboarding },
  );
  // An invitation outranks the door: an administrator chose a seat by
  // inviting, and admitting first would refuse the invitation afterwards
  // (members cannot accept one) and lose that choice. So admission waits for
  // the invitation answer, and runs only when it came back empty. A failed
  // read is not an empty one: it may be hiding the invitation, so the door
  // stays shut and the screen beneath shows instead.
  const noInvitation =
    invitations.isSuccess && (invitations.data?.length ?? 0) === 0;
  const admitting = useAutomaticAdmission({
    admit: onboarding && noInvitation && offer.data?.outcome === "auto",
    origin,
  });

  const settled =
    !offer.isPending &&
    !mine.isPending &&
    !(onboarding && invitations.isPending);

  // For this visit only: the invitation still stands, so it must not open
  // the automatic door, and nothing lasting is recorded for it.
  const [invitationSetAside, setInvitationSetAside] = useState(false);

  return {
    settled,
    decision: offer.data,
    mine: mine.data,
    invitation:
      onboarding && !invitationSetAside ? invitations.data?.[0] : undefined,
    // The ask is held down while an invitation might be standing behind it:
    // one set aside this visit, or one a failed read could not rule out.
    askHeldDown: invitationSetAside || (onboarding && invitations.isError),
    setInvitationAside: () => setInvitationSetAside(true),
    admitting,
  };
}

/**
 * A dashboard already has an organization context. Do not replace it with a
 * domain offer for another organization; onboarding has no such context and
 * keeps the offer visible. `undefined` never reaches here (the caller returned
 * on it), so this is `null` (no context) versus a real organization id. An
 * offer naming no organization at all is nothing to show either, and nor is
 * one held down by an invitation: set aside just now, whose button said
 * "create a new organization instead" so raising the ask in its place would
 * make it take two clicks; or not ruled out because the read failed, where
 * asking could land the joiner seat over the seat an administrator chose.
 */
function offerIsNotForHere({
  decision,
  currentOrganizationId,
  askHeldDown,
}: {
  decision: Extract<JoinLookupDecision, { outcome: "ask" }>;
  currentOrganizationId: string | null;
  askHeldDown: boolean;
}): boolean {
  if (askHeldDown || decision.organizations.length === 0) return true;
  if (currentOrganizationId === null) return false;
  return !decision.organizations.some(
    (organization) => organization.organizationId === currentOrganizationId,
  );
}

/**
 * The offer itself: one button per organization on the domain, and the way
 * past. Joining LEADS. Creating your own is what happens if you decline, and
 * it is already what you have — so it needs no button here.
 */
function AskToJoinTakeover({
  organizations,
  origin,
  dismissLabel,
  onDismissed,
}: {
  organizations: ReadonlyArray<{ organizationId: string; name: string }>;
  origin: JoinRequestOrigin;
  dismissLabel: string;
  onDismissed?: () => void;
}) {
  const dismiss = api.joinRequests.dismissOffer.useMutation();
  const askToJoin = api.joinRequests.request.useMutation();
  const utils = api.useUtils();

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
      { organizationId, origin },
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
      {organizations.map((organization) => (
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

/** What the welcome screen shows for the moment the automatic door takes. */
function AdmittingTakeover({ organizationName }: { organizationName: string }) {
  return (
    <Takeover
      title={`Joining ${organizationName}`}
      intro="Your colleagues are already here, and this organization lets people on your domain straight in."
      testId="join-team-admitting"
    >
      <Text fontSize="13px" color="fg.muted" textAlign="center">
        One moment.
      </Text>
    </Takeover>
  );
}

/**
 * Walking through an automatic door from the welcome screen (ADR-143 v6).
 *
 * Fired once per mount, whatever React renders in between: an admission that
 * ran twice would be the same request made twice, and the second is refused
 * as already pending. Nothing navigates on success; the organization list is
 * refreshed and the welcome screen's own redirect carries on, honouring the
 * continuation the device page gave it.
 *
 * Returns whether the "one moment" screen should still be up. A refused
 * admission says why and steps aside, so the screen beneath (make your own
 * workspace) is reachable rather than a modal nobody can close.
 */
function useAutomaticAdmission({
  admit,
  origin,
}: {
  admit: boolean;
  origin: JoinRequestOrigin;
}): boolean {
  const admitAutomatically = api.joinRequests.admitAutomatically.useMutation();
  const utils = api.useUtils();
  const fired = useRef(false);

  useEffect(() => {
    if (!admit || fired.current) return;
    fired.current = true;
    admitAutomatically.mutate(
      { origin },
      {
        onError: (error) =>
          showErrorToast({ error, fallbackTitle: "Couldn't join just now" }),
        onSettled: () => {
          void utils.organization.getAll.invalidate();
          void utils.joinRequests.offer.invalidate();
          void utils.joinRequests.mine.invalidate();
        },
      },
    );
  }, [admit, origin, admitAutomatically, utils]);

  return admit && !admitAutomatically.isError;
}

/**
 * An invitation that was already waiting (ADR-143 v6), led with instead of
 * the ask. Accepting runs the invitation's own path, so the seat is the one
 * the invitation names and any open request is withdrawn as it always was.
 * Nothing navigates from here either: the welcome screen reads the
 * organization list and carries on to wherever it was going.
 */
function InvitationTakeover({
  invitation,
  dismissLabel,
  onSetAside,
}: {
  invitation: { inviteCode: string; organizationName: string; role: string };
  dismissLabel: string;
  /** The way past, as on the ask screen: somebody who would rather have
   *  their own workspace, or whose invitation was withdrawn under them, is
   *  never stuck behind a screen with one button. */
  onSetAside: () => void;
}) {
  const accept = api.invite.acceptInvite.useMutation();
  const utils = api.useUtils();
  const seat =
    orgRoleOptions.find((option) => option.value === invitation.role)?.label ??
    invitation.role;

  return (
    <Takeover
      title={`You’re invited to join ${invitation.organizationName}`}
      intro={`An administrator has already invited you, with the ${seat} seat.`}
      testId="join-team-invitation"
    >
      <AuthPrimaryButton
        isBusy={accept.isPending}
        onClick={() =>
          accept.mutate(
            { inviteCode: invitation.inviteCode },
            {
              onSuccess: () => {
                void utils.organization.getAll.invalidate();
                void utils.invite.pendingForMe.invalidate();
                // Accepting withdrew any request this person had open, so
                // the cached one must not bring the waiting screen back.
                void utils.joinRequests.mine.invalidate();
                void utils.joinRequests.offer.invalidate();
              },
              onError: (error) => {
                showErrorToast({
                  error,
                  fallbackTitle: "Couldn't accept the invitation",
                });
                // An invitation withdrawn under them drops off on the re-read
                // instead of offering a button that can only fail again.
                void utils.invite.pendingForMe.invalidate();
              },
            },
          )
        }
      >
        Accept the invitation to {invitation.organizationName}
      </AuthPrimaryButton>
      <SecondaryAction onClick={onSetAside}>{dismissLabel}</SecondaryAction>
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
