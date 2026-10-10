import { ActivityTimeline } from "@langwatch/design-system/activity-timeline";
import { DetailDrawerHeader } from "@langwatch/design-system/detail-drawer-header";
import { Drawer } from "@langwatch/design-system/drawer";
import {
  Alert,
  Badge,
  Box,
  Button,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { ResourceRow } from "@langwatch/design-system/resource-row";
import { SummaryList, SummaryListItem } from "@langwatch/design-system/summary-list";
import type { LookupPerson, LookupPersonDetail } from "@langwatch/identity-contract";
import { nowInstant } from "@langwatch/time";
import { KeyRound, UserRound } from "lucide-react";
import { useRef, useState } from "react";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsToaster, useShowErrorToast } from "../../../../behavior/ops-feedback.ts";
import { Dialog } from "../../../../ui/elements/ops-dialog.tsx";
import {
  identifierStateLabel,
  identityFactLabel,
  proposalReasonLabel,
  repairConfirmationTitle,
  repairTargetIsNameable,
  shortenIdentifier,
  waitedFor,
} from "../../model/identity-lookup-copy.ts";
import { formatDateTime } from "../elements/admin-cells.tsx";
import { ShortId } from "../elements/short-id.tsx";

/** One person beside the list: how they sign in, what waits on a human, what happened. */
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
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Drawer.Root
      open={!!userId}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
      size="2xl"
      initialFocusEl={() => contentRef.current}
    >
      <Drawer.Content ref={contentRef} tabIndex={-1} width="calc(100vw - 16px)">
        <Drawer.Header borderBottomWidth="1px" borderColor="border.muted" padding={6}>
          <DetailDrawerHeader
            kind="Person"
            icon={<UserRound size={20} />}
            title={held?.person.name ?? held?.person.email ?? "Person details"}
          >
            {held?.person.email ?? address}
          </DetailDrawerHeader>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body padding={6}>
          {detail.error && (
            <VStack align="stretch" gap={4}>
              <Alert.Root status="error" role="alert">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>Couldn't load this person</Alert.Title>
                  <Alert.Description>
                    The person's details are unavailable. Try again.
                  </Alert.Description>
                </Alert.Content>
              </Alert.Root>
              <Button
                alignSelf="start"
                variant="outline"
                loading={detail.isFetching}
                onClick={() => void detail.refetch()}
              >
                Try again
              </Button>
            </VStack>
          )}
          {!detail.error && !held && address.length > 0 && (
            <VStack align="stretch" gap={4} as="output" aria-label="Loading person details">
              <Text color="fg.muted" fontSize="sm">
                Loading person details…
              </Text>
              <Skeleton height="24" />
              <Skeleton height="32" />
              <Skeleton height="32" />
            </VStack>
          )}
          {!detail.error && !held && !address && (
            <Text color="fg.muted">
              Close this panel and enter an email address to load this person.
            </Text>
          )}
          {!detail.error && held && (
            <VStack align="stretch" gap={6}>
              <PersonFacts person={held.person} />
              <MethodsPanel detail={held} canRepair={canRepair} userId={held.person.userId} />
              <WaitingPanel detail={held} canRepair={canRepair} userId={held.person.userId} />
              <HistoryPanel history={held.history} />
            </VStack>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function PersonFacts({ person }: { person: LookupPerson }) {
  return (
    <SummaryList>
      <SummaryListItem label="Identifier">
        <ShortId id={person.userId} />
      </SummaryListItem>
      <SummaryListItem label="Email">{person.email}</SummaryListItem>
      <SummaryListItem label="Organizations">
        {person.organizations
          .map(
            (organization) => organization.name ?? shortenIdentifier(organization.organizationId),
          )
          .join(", ") || "No organizations"}
      </SummaryListItem>
    </SummaryList>
  );
}

/** One sign-in method in any state, with what proved it and when; removed ones stay listed. */
function IdentifierRow({
  identifier,
  sessions,
  canRepair,
  nameable,
  onEndSessions,
  onRemove,
}: {
  identifier: LookupPersonDetail["identifiers"][number];
  sessions: LookupPersonDetail["sessions"];
  canRepair: boolean;
  nameable: boolean;
  onEndSessions: () => void;
  onRemove: () => void;
}) {
  const removed = identifier.state === "DETACHED";

  return (
    <VStack align="stretch" gap={2}>
      <ResourceRow
        icon={<KeyRound size={16} />}
        name={
          <Text as="span" color={removed ? "fg.muted" : "fg"}>
            {identifier.value ?? identifier.provider}
          </Text>
        }
        status={
          <Badge variant="subtle">
            {removed ? "Removed" : identifierStateLabel(identifier.state)}
          </Badge>
        }
        description={
          <>
            Attached {formatDateTime(identifier.attachedAtMs)}
            {identifier.verifiedAtMs
              ? ` · proved by ${identifier.provider} on ${formatDateTime(identifier.verifiedAtMs)}`
              : " · nothing has proved it"}
            {identifier.detachedAtMs ? ` · Removed ${formatDateTime(identifier.detachedAtMs)}` : ""}
          </>
        }
        meta={
          sessions.length > 0
            ? `${sessions.length} signed-in ${sessions.length === 1 ? "device" : "devices"}`
            : void 0
        }
      />
      {canRepair && !removed && (
        <HStack gap={2}>
          {sessions.length > 0 && (
            <Button size="xs" variant="outline" onClick={onEndSessions}>
              End its sessions
            </Button>
          )}
          {nameable ? (
            <Button size="xs" variant="outline" colorPalette="red" onClick={onRemove}>
              Remove
            </Button>
          ) : (
            <Text fontSize="xs" color="fg.muted" maxWidth="220px">
              Repairs are unavailable: this person's organization cannot be named, so there is no
              way to confirm which customer this would affect.
            </Text>
          )}
        </HStack>
      )}
    </VStack>
  );
}

/** The confirmation names the customer a repair would land on. */
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
        <Dialog.CloseTrigger />
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
            {personName} will no longer be able to sign in with this method. If it is their last way
            in, or the last one we could reach them at, the removal is refused and nothing changes.
          </Text>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={onCancel}>
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

/** A repair's success toast and its failure, read from the code-keyed registry. */
function useLookupSettlement() {
  const utils = api.useContext();
  const toaster = useOpsToaster();
  const showErrorToast = useShowErrorToast();
  return {
    succeeded: async (title: string) => {
      await utils.identityLookup.invalidate();
      toaster.create({ title, type: "success", duration: 3000 });
    },
    failed: (fallbackTitle: string) => (error: unknown) => showErrorToast({ error, fallbackTitle }),
  };
}

function MethodsPanel({
  detail,
  canRepair,
  userId,
}: {
  detail: LookupPersonDetail;
  canRepair: boolean;
  userId: string;
}) {
  const settle = useLookupSettlement();
  const [detaching, setDetaching] = useState<string | null>(null);

  const detach = api.identityLookup.detachMethod.useMutation({
    onSuccess: () => settle.succeeded("Sign-in method removed"),
    onError: settle.failed("Couldn't remove the sign-in method"),
  });
  const endSessions = api.identityLookup.endSessions.useMutation({
    onSuccess: () => settle.succeeded("Signed out of that method"),
    onError: settle.failed("Couldn't end the sessions"),
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
              endSessions.mutate({ userId, identifierId: identifier.identifierId })
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

function useWaitingDecisions() {
  const settle = useLookupSettlement();
  return {
    confirm: api.identityLookup.confirmProposedSignIn.useMutation({
      onSuccess: () => settle.succeeded("Sign-in confirmed"),
      onError: settle.failed("Couldn't confirm the sign-in"),
    }),
    reject: api.identityLookup.rejectProposedSignIn.useMutation({
      onSuccess: () => settle.succeeded("Sign-in rejected"),
      onError: settle.failed("Couldn't reject the sign-in"),
    }),
    resend: api.identityLookup.resendInvitation.useMutation({
      onSuccess: () => settle.succeeded("A fresh invitation went out"),
      onError: settle.failed("Couldn't resend the invitation"),
    }),
    extend: api.identityLookup.extendInvitation.useMutation({
      onSuccess: (result) =>
        settle.succeeded(
          result.expiresAtMs
            ? `Now expires ${formatDateTime(result.expiresAtMs)}`
            : "Invitation extended",
        ),
      onError: settle.failed("Couldn't extend the invitation"),
    }),
  };
}

/** Everything waiting on a human on one panel, and one line when nothing is. */
function WaitingPanel({
  detail,
  canRepair,
  userId,
}: {
  detail: LookupPersonDetail;
  canRepair: boolean;
  userId: string;
}) {
  const nowMs = nowInstant().epochMilliseconds;
  const decide = useWaitingDecisions();

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
                Waiting {waitedFor({ sinceMs: proposal.proposedAtMs, nowMs })} because{" "}
                {proposalReasonLabel(proposal.reason)}.
              </Text>
            </VStack>
            {canRepair && (
              <HStack gap={2}>
                <Button
                  size="xs"
                  onClick={() => decide.confirm.mutate({ userId, proposalId: proposal.proposalId })}
                >
                  Confirm
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => decide.reject.mutate({ userId, proposalId: proposal.proposalId })}
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
                {invitation.organizationName ?? shortenIdentifier(invitation.organizationId)}
                {invitation.invitedByName ? `, sent by ${invitation.invitedByName}` : ""}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {invitation.expiresAtMs === null
                  ? "Does not expire."
                  : `${invitation.isExpired ? "Expired" : "Expires"} ${formatDateTime(invitation.expiresAtMs)}.`}
              </Text>
            </VStack>
            {canRepair && (
              <HStack gap={2}>
                <Button
                  size="xs"
                  onClick={() =>
                    decide.resend.mutate({
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
                    decide.extend.mutate({
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
          <HStack key={`${claim.connectionId}:${claim.domain}`} justify="space-between">
            <Text fontSize="sm">
              Domain claim on {claim.domain} by{" "}
              {claim.organizationName ?? shortenIdentifier(claim.organizationId)}
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

/** The most recent identity facts, newest first; payloads carry addresses, never
 *  secrets (ADR-101 §4). */
function HistoryPanel({ history }: { history: LookupPersonDetail["history"] }) {
  return (
    <Box data-testid="identity-history">
      <ActivityTimeline
        title="History"
        emptyState="Nothing has happened to this person's identity yet."
        entries={history.map((entry) => ({
          id: entry.eventId,
          occurredAtMs: entry.occurredAtMs,
          content: identityFactLabel(entry.type),
          meta: (
            <>
              {entry.actor.type === "system"
                ? "by LangWatch"
                : `by ${entry.actor.id ?? "somebody"}`}
              {entry.value ? ` · ${entry.value}` : ""}
              {entry.detail ? ` · ${entry.detail}` : ""}
            </>
          ),
        }))}
      />
    </Box>
  );
}
