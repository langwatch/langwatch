import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import type {
  LookupPerson,
  LookupPersonDetail,
} from "~/server/app-layer/identity/identity-lookup.service";
import { api } from "~/utils/api";
import { formatDateTime } from "../BackofficeTable";
import {
  identifierStateLabel,
  identityFactLabel,
  proposalReasonLabel,
  repairConfirmationTitle,
  repairTargetIsNameable,
  shortenIdentifier,
  waitedFor,
} from "./identityLookupCopy";
import { ShortId } from "./ShortId";

/**
 * One person, beside the list.
 *
 * Four panels in the order a support case reads them: how they sign in, what
 * is waiting on a human, what has happened, and where they are signed in.
 * Every repair on this surface lives here rather than on the row, because a
 * repair has to name what it lands on and the row has not said which method
 * or which invitation.
 */
export function IdentityLookupDrawer({
  userId,
  address,
  canRepair,
  onClose,
}: {
  userId: string | null;
  address: string;
  canRepair: boolean;
  onClose: () => void;
}) {
  const detail = api.identityLookup.person.useQuery(
    { userId: userId ?? "", address },
    { enabled: !!userId && address.length > 0, retry: false },
  );
  const held = detail.data;

  return (
    <Drawer.Root
      open={!!userId}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
      size="xl"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            {held?.person.name ?? held?.person.email ?? "Person"}
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          {held && (
            <VStack align="stretch" gap={6}>
              <PersonFacts person={held.person} />
              <MethodsPanel
                detail={held}
                canRepair={canRepair}
                userId={held.person.userId}
              />
              <WaitingPanel
                detail={held}
                canRepair={canRepair}
                userId={held.person.userId}
              />
              <HistoryPanel history={held.history} />
            </VStack>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

/**
 * The answer's shape, taken from the service that produces it rather than
 * inferred back out of the query hook. A type import is erased, so this
 * costs the browser bundle nothing and buys the panels below their fields.
 */
type PersonDetail = LookupPersonDetail;
type Person = LookupPerson;

function PersonFacts({ person }: { person: Person }) {
  return (
    <VStack align="start" gap={1}>
      <HStack gap={2}>
        <Text color="fg.muted" fontSize="sm">
          Identifier
        </Text>
        <ShortId id={person.userId} />
      </HStack>
      <Text fontSize="sm">
        {person.organizations.length === 0
          ? "Belongs to no organization."
          : `Belongs to ${person.organizations
              .map(
                (organization) =>
                  organization.name ??
                  shortenIdentifier(organization.organizationId),
              )
              .join(", ")}.`}
      </Text>
    </VStack>
  );
}

/**
 * Every sign-in method, in every state, with what proved it and when.
 *
 * DETACHED rows stay: "this address used to sign them in and no longer does"
 * is the answer to half the support cases that reach this page, and a list
 * that hid them would send the operator back to a database console.
 */
/**
 * One sign-in method, and what an operator may do to it.
 *
 * Lifted out of the panel's `map` because the callback carried the whole row:
 * its dates, its session count, and the two repair buttons with the naming
 * rule between them. A row is a thing; a closure that draws a row is a
 * closure nobody can read.
 */
function IdentifierRow({
  identifier,
  sessions,
  canRepair,
  nameable,
  onEndSessions,
  onRemove,
}: {
  identifier: PersonDetail["identifiers"][number];
  sessions: PersonDetail["sessions"];
  canRepair: boolean;
  nameable: boolean;
  onEndSessions: () => void;
  onRemove: () => void;
}) {
  return (
    <Box borderWidth="1px" borderRadius="md" padding={3}>
      <HStack justify="space-between" align="start">
        <VStack align="start" gap={0}>
          <Text>
            {identifier.value ?? identifier.provider} ·{" "}
            {identifierStateLabel(identifier.state)}
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Attached {formatDateTime(new Date(identifier.attachedAtMs))}
            {identifier.verifiedAtMs
              ? ` · proved by ${identifier.provider} on ${formatDateTime(
                  new Date(identifier.verifiedAtMs),
                )}`
              : " · nothing has proved it"}
            {identifier.detachedAtMs
              ? ` · stopped counting ${formatDateTime(
                  new Date(identifier.detachedAtMs),
                )}`
              : ""}
          </Text>
          {sessions.length > 0 && (
            <Text fontSize="sm" color="fg.muted">
              {sessions.length} signed-in{" "}
              {sessions.length === 1 ? "device" : "devices"}
            </Text>
          )}
        </VStack>
        {canRepair && (
          <HStack gap={2}>
            {sessions.length > 0 && (
              <Button size="xs" variant="outline" onClick={onEndSessions}>
                End its sessions
              </Button>
            )}
            {nameable ? (
              <Button
                size="xs"
                variant="outline"
                colorPalette="red"
                onClick={onRemove}
              >
                Remove
              </Button>
            ) : (
              <Text fontSize="xs" color="fg.muted" maxWidth="220px">
                Repairs are unavailable: this person's organization cannot be
                named, so there is no way to confirm which customer this would
                affect.
              </Text>
            )}
          </HStack>
        )}
      </HStack>
    </Box>
  );
}

/** The confirmation, which names the customer a repair would land on. */
function RemoveMethodDialog({
  identifierId,
  personName,
  organizationName,
  onCancel,
  onConfirm,
}: {
  identifierId: string | null;
  personName: string | null;
  organizationName: string | null;
  onCancel: () => void;
  onConfirm: (identifierId: string) => void;
}) {
  return (
    <Dialog.Root
      open={identifierId !== null}
      onOpenChange={({ open }) => {
        if (!open) onCancel();
      }}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>
            {repairConfirmationTitle({
              verb: "Remove a sign-in method",
              personName: personName ?? "",
              organizationName: organizationName ?? "",
            })}
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Text>
            {personName} will no longer be able to sign in with this method. If
            it is their last way in, or the last one we could reach them at, the
            removal is refused and nothing changes.
          </Text>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            colorPalette="red"
            onClick={() => {
              if (identifierId) onConfirm(identifierId);
            }}
          >
            Remove
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function MethodsPanel({
  detail,
  canRepair,
  userId,
}: {
  detail: PersonDetail;
  canRepair: boolean;
  userId: string;
}) {
  const utils = api.useContext();
  const [detaching, setDetaching] = useState<string | null>(null);

  const detach = api.identityLookup.detachMethod.useMutation({
    onSuccess: async () => {
      await utils.identityLookup.invalidate();
      toaster.create({
        title: "Sign-in method removed",
        type: "success",
        duration: 3000,
      });
    },
    // The strands refusal arrives here. It is rendered, never pre-empted:
    // whether removing this method would leave somebody with no way back in
    // is the guard's decision, and a second copy on this surface is the copy
    // that goes stale.
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't remove the sign-in method",
      }),
  });
  const endSessions = api.identityLookup.endSessions.useMutation({
    onSuccess: async () => {
      await utils.identityLookup.invalidate();
      toaster.create({
        title: "Signed out of that method",
        type: "success",
        duration: 3000,
      });
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't end the sessions" }),
  });

  const organizationName = detail.person.organizations[0]?.name ?? null;
  const personName = detail.person.name ?? detail.person.email ?? null;
  const nameable = repairTargetIsNameable({ organizationName, personName });

  return (
    <Box>
      <Text fontWeight="semibold" marginBottom={2}>
        Sign-in methods
      </Text>
      {detail.identifiers.length === 0 && (
        <Text color="fg.muted" fontSize="sm">
          This person holds no sign-in methods.
        </Text>
      )}
      <VStack align="stretch" gap={3}>
        {detail.identifiers.map((identifier) => (
          <IdentifierRow
            key={identifier.identifierId}
            identifier={identifier}
            sessions={detail.sessions.filter(
              (session) => session.identifierId === identifier.identifierId,
            )}
            canRepair={canRepair}
            nameable={nameable}
            onEndSessions={() =>
              endSessions.mutate({
                userId,
                identifierId: identifier.identifierId,
              })
            }
            onRemove={() => setDetaching(identifier.identifierId)}
          />
        ))}
      </VStack>

      <RemoveMethodDialog
        identifierId={detaching}
        personName={personName}
        organizationName={organizationName}
        onCancel={() => setDetaching(null)}
        onConfirm={(identifierId) => {
          detach.mutate({ userId, identifierId });
          setDetaching(null);
        }}
      />
    </Box>
  );
}

/**
 * The four repairs the waiting panel can make, and nothing else.
 *
 * A hook rather than seventy lines at the top of the panel: every one of these
 * is the same shape — invalidate, say what happened, and let the code-keyed
 * registry own the words on the way down — and reading the panel's markup
 * meant scrolling past all four of them first. Returns the mutations, never
 * anything to render.
 */
function useWaitingDecisions() {
  const utils = api.useContext();
  const invalidate = async () => {
    await utils.identityLookup.invalidate();
  };
  const decide = {
    confirm: api.identityLookup.confirmProposedSignIn.useMutation({
      onSuccess: async () => {
        await invalidate();
        toaster.create({
          title: "Sign-in confirmed",
          type: "success",
          duration: 3000,
        });
      },
      onError: (error) =>
        showErrorToast({
          error,
          fallbackTitle: "Couldn't confirm the sign-in",
        }),
    }),
    reject: api.identityLookup.rejectProposedSignIn.useMutation({
      onSuccess: async () => {
        await invalidate();
        toaster.create({
          title: "Sign-in rejected",
          type: "success",
          duration: 3000,
        });
      },
      onError: (error) =>
        showErrorToast({ error, fallbackTitle: "Couldn't reject the sign-in" }),
    }),
  };
  const resend = api.identityLookup.resendInvitation.useMutation({
    onSuccess: async () => {
      await invalidate();
      toaster.create({
        title: "A fresh invitation went out",
        type: "success",
        duration: 3000,
      });
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't resend the invitation",
      }),
  });
  const extend = api.identityLookup.extendInvitation.useMutation({
    onSuccess: async (result) => {
      await invalidate();
      toaster.create({
        title: result.expiresAtMs
          ? `Now expires ${formatDateTime(new Date(result.expiresAtMs))}`
          : "Invitation extended",
        type: "success",
        duration: 5000,
      });
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't extend the invitation",
      }),
  });

  return { decide, resend, extend };
}

/**
 * Everything waiting on a human, on one panel.
 *
 * Sign-ins awaiting confirmation, invitations with their expiry, and domain
 * claims awaiting review. When none of the three has anything, the panel is
 * ONE LINE — three empty sections each explaining their own emptiness is a
 * page filled up to say nothing.
 */
function WaitingPanel({
  detail,
  canRepair,
  userId,
}: {
  detail: PersonDetail;
  canRepair: boolean;
  userId: string;
}) {
  const nowMs = Date.now();
  const { decide, resend, extend } = useWaitingDecisions();

  if (detail.waiting.isEmpty) {
    return (
      <Text color="fg.muted" fontSize="sm" data-testid="waiting-empty">
        Nothing is waiting on a human.
      </Text>
    );
  }

  return (
    <Box>
      <Text fontWeight="semibold" marginBottom={2}>
        Waiting
      </Text>
      <VStack align="stretch" gap={3}>
        {detail.waiting.proposals.map((proposal) => (
          <HStack key={proposal.proposalId} justify="space-between">
            <VStack align="start" gap={0}>
              <Text fontSize="sm">
                Sign-in through {proposal.provider} for{" "}
                {proposal.value ?? proposal.domain ?? "an address"}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                Waiting {waitedFor({ sinceMs: proposal.proposedAtMs, nowMs })}{" "}
                because {proposalReasonLabel(proposal.reason)}.
              </Text>
            </VStack>
            {canRepair && (
              <HStack gap={2}>
                <Button
                  size="xs"
                  onClick={() =>
                    decide.confirm.mutate({
                      userId,
                      proposalId: proposal.proposalId,
                    })
                  }
                >
                  Confirm
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    decide.reject.mutate({
                      userId,
                      proposalId: proposal.proposalId,
                    })
                  }
                >
                  Reject
                </Button>
              </HStack>
            )}
          </HStack>
        ))}

        {detail.waiting.invitations.map((invitation) => (
          <HStack key={invitation.inviteId} justify="space-between">
            <VStack align="start" gap={0}>
              <Text fontSize="sm">
                Invitation to{" "}
                {invitation.organizationName ??
                  shortenIdentifier(invitation.organizationId)}
                {invitation.invitedByName
                  ? `, sent by ${invitation.invitedByName}`
                  : ""}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {invitation.expiresAtMs === null
                  ? "Does not expire."
                  : invitation.isExpired
                    ? `Expired ${formatDateTime(new Date(invitation.expiresAtMs))}.`
                    : `Expires ${formatDateTime(new Date(invitation.expiresAtMs))}.`}
              </Text>
            </VStack>
            {canRepair && (
              <HStack gap={2}>
                <Button
                  size="xs"
                  onClick={() =>
                    resend.mutate({
                      organizationId: invitation.organizationId,
                      inviteId: invitation.inviteId,
                    })
                  }
                >
                  Resend
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    extend.mutate({
                      organizationId: invitation.organizationId,
                      inviteId: invitation.inviteId,
                    })
                  }
                >
                  Extend
                </Button>
              </HStack>
            )}
          </HStack>
        ))}

        {detail.waiting.domainClaims.map((claim) => (
          <HStack
            key={`${claim.connectionId}:${claim.domain}`}
            justify="space-between"
          >
            <Text fontSize="sm">
              Domain claim on {claim.domain} by{" "}
              {claim.organizationName ??
                shortenIdentifier(claim.organizationId)}
            </Text>
            <Text fontSize="sm" color="fg.muted">
              waiting {waitedFor({ sinceMs: claim.waitingSinceMs, nowMs })}
            </Text>
          </HStack>
        ))}
      </VStack>
    </Box>
  );
}

/**
 * The most recent identity facts, newest first.
 *
 * What the log carries and nothing it does not: what happened, who caused
 * it, when, and the one enum the fact turns on. Identity payloads hold
 * addresses and never secrets (ADR-101 §4), which is why an address is on
 * screen here and why there is no field a token could arrive in.
 */
function HistoryPanel({ history }: { history: PersonDetail["history"] }) {
  return (
    <Box>
      <Text fontWeight="semibold" marginBottom={2}>
        History
      </Text>
      {history.length === 0 && (
        <Text color="fg.muted" fontSize="sm">
          Nothing has happened to this person's identity yet.
        </Text>
      )}
      <VStack align="stretch" gap={2} data-testid="identity-history">
        {history.map((entry) => (
          <HStack key={entry.eventId} justify="space-between" align="start">
            <VStack align="start" gap={0}>
              <Text fontSize="sm">{identityFactLabel(entry.type)}</Text>
              <Text fontSize="sm" color="fg.muted">
                {entry.actor.type === "system"
                  ? "by LangWatch"
                  : `by ${entry.actor.id ?? "somebody"}`}
                {entry.value ? ` · ${entry.value}` : ""}
                {entry.detail ? ` · ${entry.detail}` : ""}
              </Text>
            </VStack>
            <Text fontSize="sm" color="fg.muted">
              {formatDateTime(new Date(entry.occurredAtMs))}
            </Text>
          </HStack>
        ))}
      </VStack>
    </Box>
  );
}
