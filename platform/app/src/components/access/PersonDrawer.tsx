import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Separator,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Ban, Trash2, Undo2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useDrawer } from "~/hooks/useDrawer";
import { useMemberDisableAction } from "~/hooks/useMemberDisableAction";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api, type RouterOutputs } from "~/utils/api";
import { SecondFactorCell } from "../members/SecondFactorCell";
import { useTwoStepRequirement } from "../members/useTwoStepRequirement";
import { SectionErrorNotice } from "../settings/SectionErrorNotice";
import { IdentityChip, IdentityRow } from "./IdentityRow";
import { MemberAccessEditor } from "./MemberAccessEditor";
import { type MemberProvenance, ProvenanceChip } from "./ProvenanceChip";

/**
 * One person, opened from the members list (D05).
 *
 * A URL-routed drawer rather than the dialog it replaces, for the reason
 * drawers.md gives: a person is a thing an administrator links to, comes back
 * to, and sends to a colleague in a support thread, and a dialog behind a
 * `useState` flag can be none of those. `?drawer.open=person&userId=…` is the
 * whole address.
 *
 * Three questions, in the order an administrator asks them: who is this,
 * what can they reach, and what am I going to do about it. Identity first
 * because it is what the person came to check — the address, whether it is
 * proved, whether they can show a second factor, and why they are here at
 * all.
 *
 * Impersonation is deliberately absent. Signing in as somebody is an
 * operator's act with an operator's audit trail, and it lives in the back
 * office; putting it a click from "change role" would make it look like part
 * of ordinary member administration.
 */
export function PersonDrawer({
  open = true,
  userId,
}: {
  open?: boolean;
  userId?: string;
}) {
  const { closeDrawer } = useDrawer();
  const { organization, hasPermission } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });
  const organizationId = organization?.id ?? "";
  const canManage = hasPermission("organization:manage");

  return (
    <Drawer.Root
      open={open}
      placement="end"
      size="lg"
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) closeDrawer();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.Title>
            <Heading size="lg">Person</Heading>
          </Drawer.Title>
          <Drawer.CloseTrigger onClick={closeDrawer} />
        </Drawer.Header>
        <Drawer.Body paddingBottom={8}>
          {userId && organizationId ? (
            <PersonDetail
              organizationId={organizationId}
              userId={userId}
              canManage={canManage}
              onDone={closeDrawer}
            />
          ) : (
            <Text color="fg.muted" fontSize="sm">
              This link does not name anybody. Open a person from the members
              list.
            </Text>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function PersonDetail({
  organizationId,
  userId,
  canManage,
  onDone,
}: {
  organizationId: string;
  userId: string;
  canManage: boolean;
  onDone: () => void;
}) {
  const {
    isSelf,
    member,
    provenance,
    twoStep,
    confirmingRemoval,
    setConfirmingRemoval,
    removeMember,
    setMemberDisabled,
    isSettingDisabled,
  } = usePersonDetail({ organizationId, userId, canManage });

  const refusal = personDrawerRefusal({ canManage, member });
  if (refusal) return refusal;

  const person = member.data!;
  const disabled = !!person.disabledAt;

  return (
    <VStack align="stretch" gap={6}>
      <IdentityRow
        id={person.userId}
        name={person.user.name}
        address={person.user.email}
        image={person.user.image}
        badges={
          <>
            {person.role === "EXTERNAL" ? (
              <Badge colorPalette="gray" size="sm">
                Lite Member
              </Badge>
            ) : null}
            {person.user.deactivatedAt ? (
              <Badge colorPalette="red" size="sm">
                Deactivated
              </Badge>
            ) : null}
            {disabled ? (
              <Badge colorPalette="orange" size="sm">
                Disabled
              </Badge>
            ) : null}
          </>
        }
        chips={<ProvenanceChip provenance={provenance.data?.[person.userId]} />}
      />

      <HowTheySignIn
        person={person}
        provenance={provenance}
        twoStep={twoStep}
      />
      <Section title="What they can reach">
        <MemberAccessEditor
          organizationId={organizationId}
          userId={person.userId}
          memberRole={person.role}
          canManage={canManage}
          isCurrentUser={isSelf}
        />
      </Section>

      {isSelf ? null : (
        <PersonActions
          person={person}
          disabled={disabled}
          onDone={onDone}
          organizationId={organizationId}
          confirmingRemoval={confirmingRemoval}
          setConfirmingRemoval={setConfirmingRemoval}
          removeMember={removeMember}
          setMemberDisabled={setMemberDisabled}
          isSettingDisabled={isSettingDisabled}
        />
      )}
    </VStack>
  );
}

/** The prose behind the chip, for somebody who opened the person to ask. */
function ProvenanceExplanation({
  provenance,
}: {
  provenance: MemberProvenance | undefined;
}) {
  if (!provenance || provenance.source === "unknown") {
    return (
      <Text fontSize="sm" color="fg.muted">
        Nothing on record says how they got here. That is what an organization
        founder looks like, and anybody who joined before we started keeping
        this.
      </Text>
    );
  }
  if (provenance.source === "directory") {
    return (
      <Text fontSize="sm" color="fg.muted">
        {provenance.providerId
          ? `${provenance.providerId} created them.`
          : "Your identity provider created them."}{" "}
        It decides whether they stay, and removing them here does not stop it
        putting them back.
      </Text>
    );
  }
  if (provenance.source === "domain") {
    return (
      <Text fontSize="sm" color="fg.muted">
        {provenance.automatic
          ? `They joined on ${provenance.domain} under your joining policy, without anybody approving.`
          : `They asked to join on ${provenance.domain}, and an administrator approved it.`}
      </Text>
    );
  }
  return (
    <Text fontSize="sm" color="fg.muted">
      Somebody here invited them, and they accepted.
    </Text>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <VStack align="stretch" gap={3} width="full">
      <Heading as="h3" size="sm">
        {title}
      </Heading>
      <Separator />
      {children}
    </VStack>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <VStack align="start" gap={1} width="full">
      <Text fontSize="xs" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Box width="full">{children}</Box>
    </VStack>
  );
}

/**
 * What the drawer knows about one person, and what it can do to them.
 *
 * The drawer can be pointed at a DIFFERENT person without unmounting, which is
 * why the confirmation resets on `userId`: a pending "remove" left open on one
 * person must never carry over to the next one opened.
 */
function usePersonDetail({
  organizationId,
  userId,
  canManage,
}: {
  organizationId: string;
  userId: string;
  canManage: boolean;
}) {
  const { data: session } = useRequiredSession();
  const isSelf = session?.user?.id === userId;
  const queryClient = api.useUtils();

  const member = api.organization.getMemberById.useQuery(
    { organizationId, userId },
    { enabled: canManage },
  );
  const provenance = api.organization.getMemberProvenance.useQuery(
    { organizationId },
    { enabled: canManage },
  );
  const twoStep = useTwoStepRequirement({ organizationId, canManage });

  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  // The drawer can be pointed at a different person without unmounting, so a
  // confirmation left open on one person never carries over to the next.
  useEffect(() => {
    setConfirmingRemoval(false);
  }, [userId]);

  const removeMember = api.organization.deleteMember.useMutation();
  const { setMemberDisabled, isSettingDisabled } = useMemberDisableAction({
    organizationId,
    onChanged: () => {
      void queryClient.organization.getMemberById.invalidate();
      void queryClient.organization.getOrganizationWithMembersAndTheirTeams.invalidate();
      void queryClient.limits.getUsage.invalidate();
      void queryClient.licenseEnforcement.checkLimit.invalidate();
    },
  });

  return {
    isSelf,
    member,
    provenance,
    twoStep,
    confirmingRemoval,
    setConfirmingRemoval,
    removeMember,
    setMemberDisabled,
    isSettingDisabled,
  };
}

/**
 * How this person gets in: the address, whether they proved it, what brought
 * them here, and their second factor where the organization asks for one.
 *
 * Whether the ADDRESS is verified is stated next to it rather than left
 * implied: an unproved address cannot be used to join by domain, which is
 * exactly the question somebody opens this drawer with.
 */
function HowTheySignIn({
  person,
  provenance,
  twoStep,
}: {
  person: NonNullable<RouterOutputs["organization"]["getMemberById"]>;
  provenance: {
    data?: RouterOutputs["organization"]["getMemberProvenance"];
    isError: boolean;
    error: unknown;
  };
  twoStep: ReturnType<typeof useTwoStepRequirement>;
}) {
  return (
    <Section title="How they sign in">
      <VStack align="start" gap={3} width="full">
        <Fact label="Address">
          <HStack gap={2}>
            <Text fontSize="sm">{person.user.email ?? "None on file"}</Text>
            {person.user.email ? (
              <IdentityChip
                label={person.user.emailVerified ? "Verified" : "Unverified"}
                tone={person.user.emailVerified ? "good" : "warning"}
                title={
                  person.user.emailVerified
                    ? "They proved this address."
                    : "They have not proved this address yet, so it cannot be used to join by domain."
                }
                data-testid="person-address-state"
              />
            ) : null}
          </HStack>
        </Fact>
        {twoStep.show ? (
          <Fact label="Second factor">
            <SecondFactorCell
              member={twoStep.byUser.get(person.userId)}
              mfaRequired={twoStep.mfaRequired}
            />
          </Fact>
        ) : null}
        <Fact label="Why they are here">
          {provenance.isError ? (
            <Text fontSize="sm" color="fg.muted">
              We couldn&apos;t work that out just now.
            </Text>
          ) : (
            <ProvenanceExplanation
              provenance={provenance.data?.[person.userId]}
            />
          )}
        </Fact>
      </VStack>
    </Section>
  );
}

/**
 * What an administrator can do to somebody, and the confirmation in front of
 * the one that cannot be undone.
 *
 * Disabling comes first and is reversible — it is how an organization gets
 * back within its licensed seats. Removal ends the membership, so it goes
 * through a dialog naming the person, the same way group and role deletion do.
 */
function PersonActions({
  person,
  disabled,
  onDone,
  organizationId,
  confirmingRemoval,
  setConfirmingRemoval,
  removeMember,
  setMemberDisabled,
  isSettingDisabled,
}: {
  person: NonNullable<RouterOutputs["organization"]["getMemberById"]>;
  disabled: boolean;
  onDone: () => void;
  organizationId: string;
  confirmingRemoval: boolean;
  setConfirmingRemoval: React.Dispatch<React.SetStateAction<boolean>>;
  removeMember: ReturnType<typeof api.organization.deleteMember.useMutation>;
  setMemberDisabled: ReturnType<
    typeof useMemberDisableAction
  >["setMemberDisabled"];
  isSettingDisabled: boolean;
}) {
  const queryClient = api.useUtils();
  return (
    <>
      <Section title="Actions">
        <VStack align="start" gap={3} width="full">
          <HStack gap={2}>
            <Button
              size="sm"
              variant="outline"
              loading={isSettingDisabled}
              onClick={() => setMemberDisabled(person.userId, !disabled)}
            >
              {disabled ? <Undo2 size={14} /> : <Ban size={14} />}
              {disabled ? "Give their seat back" : "Take their seat away"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              colorPalette="red"
              onClick={() => setConfirmingRemoval(true)}
            >
              <Trash2 size={14} />
              Remove from organization
            </Button>
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            Taking a seat away is reversible and frees a licensed seat. Removing
            ends their membership of this organization; their account and
            everything they did stay.
          </Text>
        </VStack>
      </Section>
      <ConfirmDialog
        open={confirmingRemoval}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirmingRemoval(false);
        }}
        title="Remove from organization"
        message={`Remove ${
          person.user.name ?? person.user.email ?? "this member"
        } from this organization? They lose access to everything in it.`}
        confirmLabel="Remove"
        tone="danger"
        loading={removeMember.isPending}
        onConfirm={() =>
          removeMember.mutate(
            { organizationId, userId: person.userId },
            {
              onSuccess: () => {
                toaster.create({
                  title: "Member removed",
                  description:
                    "They no longer have access to this organization.",
                  type: "success",
                  duration: 5000,
                });
                void queryClient.organization.getOrganizationWithMembersAndTheirTeams.invalidate();
                void queryClient.limits.getUsage.invalidate();
                void queryClient.licenseEnforcement.checkLimit.invalidate();
                setConfirmingRemoval(false);
                onDone();
              },
              onError: (error) =>
                showErrorToast({
                  error,
                  fallbackTitle: "Couldn't remove this member",
                }),
            },
          )
        }
      />
    </>
  );
}

/**
 * The three reasons this drawer shows something other than a person.
 *
 * `null` means there is a person to draw. Kept together because they are one
 * question — can this reader see this person yet — rather than three
 * unrelated early returns in the middle of the markup.
 */
function personDrawerRefusal({
  canManage,
  member,
}: {
  canManage: boolean;
  member: {
    isError: boolean;
    error: unknown;
    data: unknown;
  };
}) {
  if (!canManage) {
    return (
      <Text color="fg.muted" fontSize="sm">
        You need permission to manage this organization to open a member.
      </Text>
    );
  }

  if (member.isError) {
    return (
      <SectionErrorNotice
        error={member.error}
        fallbackTitle="Couldn't open this person"
      />
    );
  }

  if (!member.data) {
    return <Spinner />;
  }

  return null;
}
