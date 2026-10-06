/**
 * One person, opened from the members list as the routed `person` drawer:
 * who they are, what they can reach, and what an administrator can do about it.
 * Impersonation is deliberately absent. Spec: specs/identity/directory-administration.feature
 */

import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Drawer } from "@langwatch/design-system/drawer";
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
} from "@langwatch/design-system/primitives";
import type { UiPersonDrawerProps } from "@langwatch/organization-contract";
import { Ban, Trash2, Undo2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { HandledErrorAlert } from "../../behavior/handled-error-form.tsx";
import { api, type RouterOutputs } from "../../behavior/organization-api.ts";
import { useOrganizationToaster, useShowErrorToast } from "../../behavior/organization-feedback.ts";
import { useDrawer } from "../../behavior/use-drawer.ts";
import { useMemberDisableAction } from "../../behavior/use-member-disable-action.ts";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project.ts";
import { useRequiredSession } from "../../behavior/use-required-session.ts";
import { useTwoStepRequirement } from "../../behavior/use-two-step-requirement.ts";
import { IdentityChip } from "../elements/identity-row.tsx";
import { ProvenanceChip, ProvenanceExplanation } from "../elements/member-provenance.tsx";
import { SecondFactorCell } from "../elements/second-factor-cell.tsx";
import { MemberAccessEditor } from "./member-access-editor.tsx";
import { PersonIdentityRow } from "./person-identity-row.tsx";

export function PersonDrawer({ open = true, userId }: UiPersonDrawerProps) {
  const { closeDrawer } = useDrawer();
  const { organization, hasPermission } = useOrganizationTeamProject();
  const organizationId = organization?.id ?? "";

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
          <Drawer.Title textStyle="lg" fontWeight="semibold">
            Person
          </Drawer.Title>
          <Drawer.CloseTrigger onClick={closeDrawer} />
        </Drawer.Header>
        <Drawer.Body paddingBottom={8}>
          {userId && organizationId ? (
            <PersonDetail
              organizationId={organizationId}
              userId={userId}
              canManage={hasPermission("organization:manage")}
              onDone={closeDrawer}
            />
          ) : (
            <Text color="fg.muted" fontSize="sm">
              This link does not name anybody. Open a person from the members list.
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
  const { data: session } = useRequiredSession();
  const isSelf = session?.user.id === userId;
  const member = api.organization.getMemberById.useQuery(
    { organizationId, userId },
    { enabled: canManage },
  );
  const provenance = api.organization.getMemberProvenance.useQuery(
    { organizationId },
    { enabled: canManage },
  );
  const twoStep = useTwoStepRequirement({ organizationId, canManage });

  if (!canManage) {
    return (
      <Text color="fg.muted" fontSize="sm">
        You need permission to manage this organization to open a member.
      </Text>
    );
  }
  if (member.isError) {
    return <HandledErrorAlert error={member.error} fallbackTitle="Couldn't open this person" />;
  }
  const person = member.data;
  if (!person) return <Spinner />;
  const disabled = !!person.disabledAt;

  return (
    <VStack align="stretch" gap={6}>
      <PersonIdentityRow
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
            {person.role === "DEVELOPER" ? (
              <Badge colorPalette="teal" size="sm">
                Developer
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
              <ProvenanceExplanation provenance={provenance.data?.[person.userId]} />
            )}
          </Fact>
        </VStack>
      </Section>

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
          organizationId={organizationId}
          person={person}
          disabled={disabled}
          onDone={onDone}
        />
      )}
    </VStack>
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
 * Taking a seat away is reversible and comes first; removal ends the membership,
 * so it goes through a dialog naming the person. A confirmation left open never
 * carries over to the next person the drawer is pointed at.
 */
function PersonActions({
  organizationId,
  person,
  disabled,
  onDone,
}: {
  organizationId: string;
  person: RouterOutputs["organization"]["getMemberById"];
  disabled: boolean;
  onDone: () => void;
}) {
  const toaster = useOrganizationToaster();
  const showErrorToast = useShowErrorToast();
  const queryClient = api.useUtils();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  useEffect(() => setConfirmingRemoval(false), [person.userId]);

  const removeMember = api.organization.deleteMember.useMutation();
  const refreshSeats = () => {
    void queryClient.organization.getOrganizationWithMembersAndTheirTeams.invalidate();
    void queryClient.limits.getUsage.invalidate();
    void queryClient.licenseEnforcement.checkLimit.invalidate();
  };
  const { setMemberDisabled, isSettingDisabled } = useMemberDisableAction({
    organizationId,
    onChanged: () => {
      void queryClient.organization.getMemberById.invalidate();
      refreshSeats();
    },
  });

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
            Taking a seat away is reversible and frees a licensed seat. Removing ends their
            membership of this organization; their account and everything they did stay.
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
                  description: "They no longer have access to this organization.",
                  type: "success",
                  duration: 5000,
                });
                refreshSeats();
                setConfirmingRemoval(false);
                onDone();
              },
              onError: (error) =>
                showErrorToast({ error, fallbackTitle: "Couldn't remove this member" }),
            },
          )
        }
      />
    </>
  );
}
