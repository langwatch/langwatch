/**
 * Everybody in the organization, at whatever distance from the door (D05, D11,
 * D12): three cuts of one list (specs/identity/directory-administration.feature).
 */

import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Dialog } from "@langwatch/design-system/dialog";
import { FilterChips } from "@langwatch/design-system/filter-chips";
import { Menu } from "@langwatch/design-system/menu";
import {
  Badge,
  Box,
  Button,
  HStack,
  Input,
  Text,
  useDisclosure,
  VStack,
} from "@langwatch/design-system/primitives";
import type { Plan as PlanInfo } from "@langwatch/entitlement-contract";
import { InviteMemberDrawerToken, PersonDrawerToken } from "@langwatch/organization-contract";
import { Ban, MoreVertical, Plus, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState, type ComponentProps } from "react";

import { HandledErrorAlert } from "../../../behavior/handled-error-form.tsx";
import type { RouterOutputs } from "../../../behavior/organization-api.ts";
import { api } from "../../../behavior/organization-api.ts";
import { useOrganizationToaster } from "../../../behavior/organization-feedback.ts";
import { reportUnexpected } from "../../../behavior/report-unexpected.ts";
import { useDepartmentColumn } from "../../../behavior/use-department-column.ts";
import { useDrawer } from "../../../behavior/use-drawer.ts";
import { useInviteActions } from "../../../behavior/use-invite-actions.ts";
import { useJoinRequests } from "../../../behavior/use-join-requests.ts";
import { useMemberDisableAction } from "../../../behavior/use-member-disable-action.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { usePublicEnv } from "../../../behavior/use-public-env.ts";
import { useRequiredSession } from "../../../behavior/use-required-session.ts";
import { useTwoStepRequirement } from "../../../behavior/use-two-step-requirement.ts";
import {
  useOrganizationHost,
  type OrganizationTeamReading,
} from "../../../model/organization-host.ts";
import {
  emptyPeopleCutText,
  parsePeopleCut,
  PEOPLE_CUT_PARAM,
  type PeopleCut,
  peopleCutItems,
  peopleCutShows,
} from "../../../model/people-cuts.ts";
import type { OrganizationUserRole } from "../../../model/prisma-types.ts";
import { JoinRequestRow } from "../../../ui/blocks/join-requests-table.tsx";
import { AutomaticJoinsNotice } from "../../../ui/elements/automatic-joins-notice.tsx";
import { CopyInput } from "../../../ui/elements/copy-input.tsx";
import { IdentityChip, IdentityRowList } from "../../../ui/elements/identity-row.tsx";
import { ProvenanceChip } from "../../../ui/elements/member-provenance.tsx";
import { orgRoleOptions } from "../../../ui/elements/organization-user-role-field.tsx";
import { SecondFactorCell } from "../../../ui/elements/second-factor-cell.tsx";
import { SectionTitle } from "../../../ui/elements/section-title.tsx";
import { SettingsRowsSkeleton } from "../../../ui/elements/settings-rows-skeleton.tsx";
import { DepartmentPicker } from "../../../ui/sections/department-picker.tsx";
import { InviteRow } from "../../../ui/sections/invites-table.tsx";
import { MemberSeatUsage } from "../../../ui/sections/member-seat-usage.tsx";
import { PersonIdentityRow } from "../person-identity-row.tsx";

/** The organization graph as the browser receives it: instants are ISO strings. */
type OrganizationWithMembersAndTheirTeams =
  RouterOutputs["organization"]["getOrganizationWithMembersAndTheirTeams"];
type Member = OrganizationWithMembersAndTheirTeams["members"][number];
type Invite = RouterOutputs["invite"]["getOrganizationPendingInvites"][number];
type Provenance = ComponentProps<typeof ProvenanceChip>["provenance"];
type RemovalTarget = { userId: string; label: string };

export default function MembersScreen() {
  const { organization } = useOrganizationTeamProject();

  const organizationWithMembers = api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
    { organizationId: organization?.id ?? "", includeDeactivated: true },
    { enabled: !!organization },
  );
  const activePlan = api.plan.getActivePlan.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization },
  );

  if (organizationWithMembers.isError) {
    return (
      <SectionErrorNotice
        error={organizationWithMembers.error}
        fallbackTitle="Couldn't load your members"
      />
    );
  }

  // The list's shape is known before its contents: a skeleton, not a jump.
  if (!organization || !organizationWithMembers.data || !activePlan.data) {
    return <SettingsRowsSkeleton rows={5} />;
  }

  return (
    <PeopleList
      organization={organizationWithMembers.data}
      teams={organization.teams}
      activePlan={activePlan.data}
    />
  );
}

/** A failure a section is still living with, said in place. */
function SectionErrorNotice({ error, fallbackTitle }: { error: unknown; fallbackTitle: string }) {
  if (!error) return null;
  return (
    <Box width="full" data-testid="section-error-notice">
      <HandledErrorAlert error={error} fallbackTitle={fallbackTitle} />
    </Box>
  );
}

/** Everything the People tab reads, decides and can do, apart from its markup. */
function usePeopleListState({
  organization,
  activePlan,
}: {
  organization: OrganizationWithMembersAndTheirTeams;
  activePlan: PlanInfo;
}) {
  const { data: session } = useRequiredSession();
  const { hasPermission } = useOrganizationTeamProject();
  const canManage = hasPermission("organization:manage");

  const host = useOrganizationHost();
  const governanceEnabled = host.isFeatureEnabled("release_ui_ai_governance_enabled");
  const department = useDepartmentColumn(organization.id, governanceEnabled);
  const showDepartment = department.show && canManage;
  const departmentNameById = useMemo(
    () => new Map(department.departments.map((option) => [option.id, option.name])),
    [department.departments],
  );

  const { openDrawer } = useDrawer();
  const { cut, selectCut } = useCutFromAddress();

  const invitesFlow = useInviteFlow({ organization, activePlan });
  const removal = useMemberRemoval(organization.id);
  const reads = usePeopleListReads({
    organization,
    canManage,
    userId: session?.user?.id,
    pendingInvites: invitesFlow.pendingInvites,
  });

  return {
    canManage,
    department,
    showDepartment,
    departmentNameById,
    openDrawer,
    cut,
    selectCut,
    ...invitesFlow,
    ...removal,
    ...reads,
  };
}

function PeopleList({
  organization,
  teams,
  activePlan,
}: {
  organization: OrganizationWithMembersAndTheirTeams;
  teams: OrganizationTeamReading[];
  activePlan: PlanInfo;
}) {
  const people = usePeopleListState({ organization, activePlan });

  return (
    <>
      <VStack align="stretch" gap={4} width="full">
        <PeopleHeader
          organizationId={organization.id}
          activePlan={activePlan}
          canManage={people.canManage}
          cut={people.cut}
          onSelectCut={people.selectCut}
          memberCount={people.sortedMembers.length}
          openInviteCount={people.openInvites.length}
          requestCount={people.joinRequests.requests.length}
          onInvite={people.openDrawer}
        />

        <SectionErrorNotice
          error={people.provenance.isError ? people.provenance.error : null}
          fallbackTitle="Couldn't work out why each person is here"
        />
        <SectionErrorNotice
          error={people.pendingInvites.isError ? people.pendingInvites.error : null}
          fallbackTitle="Couldn't load your invitations"
        />

        {/* Who walked in without anybody approving, only where somebody is looking at joiners. */}
        {(people.cut === "all" || people.cut === "waiting") && (
          <AutomaticJoinsNotice joins={people.joinRequests.automaticJoins} />
        )}

        <PeopleRows
          cut={people.cut}
          organizationId={organization.id}
          members={people.sortedMembers}
          invites={people.invites}
          openInvites={people.openInvites}
          teams={teams}
          canManage={people.canManage}
          provenance={people.provenance.data}
          department={people.department}
          departmentNameById={people.departmentNameById}
          showDepartment={people.showDepartment}
          twoStep={people.twoStep}
          joinRequests={people.joinRequests}
          canDeleteMember={people.canDeleteMember}
          canDisableMember={people.canDisableMember}
          onOpenPerson={(userId) => people.openDrawer(PersonDrawerToken, { userId })}
          onSetDisabled={people.setMemberDisabled}
          onRequestRemoval={people.setConfirmingRemoval}
          onViewInviteLink={people.viewInviteLink}
          onResendInvite={people.resendInvite}
          onRevokeInvite={people.revokeInvite}
        />
      </VStack>

      <InviteLinkDialog
        open={people.isInviteLinkOpen}
        invites={people.selectedInvites}
        onClose={people.onInviteModalClose}
      />

      <ConfirmDialog
        open={people.confirmingRemoval !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) people.setConfirmingRemoval(null);
        }}
        title="Remove from organization"
        message={`Remove ${
          people.confirmingRemoval?.label ?? "this member"
        } from this organization? They lose access to everything in it.`}
        confirmLabel="Remove"
        tone="danger"
        loading={people.deleting}
        onConfirm={() => {
          if (!people.confirmingRemoval) return;
          people.deleteMember(people.confirmingRemoval.userId);
          people.setConfirmingRemoval(null);
        }}
      />
    </>
  );
}

/** The seat a member holds, in the words the role picker uses. */
function orgRoleLabel(role: OrganizationUserRole): string {
  return orgRoleOptions.find((option) => option.value === role)?.label ?? role;
}

/** The department a member belongs to, beside their name; nothing when there is none. */
function DepartmentChip({ name }: { name: string | undefined }) {
  if (!name) return null;

  return (
    <IdentityChip
      label={name}
      title={`In the ${name} department. Departments are org structure for accounting and reporting, never an access gate.`}
      data-testid="member-department-chip"
    />
  );
}

/**
 * Row actions for a member. Disable is the reversible one, and is how an
 * organization gets back within its licensed seats; delete removes the
 * membership outright. See seat-reconciliation.feature.
 */
function MemberRowActions({
  member,
  canDisable,
  canDelete,
  onOpen,
  onSetDisabled,
  onDelete,
}: {
  member: Member;
  canDisable: boolean;
  canDelete: boolean;
  onOpen: () => void;
  onSetDisabled: (userId: string, disabled: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Actions for ${member.user.name ?? member.user.email ?? "this member"}`}
          data-testid="members-row-actions"
        >
          <MoreVertical size={16} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item value="open" data-testid="members-row-open" onClick={onOpen}>
          Open
        </Menu.Item>
        {canDisable &&
          (member.disabledAt ? (
            <Menu.Item
              value="enable"
              data-testid="members-row-enable"
              onClick={() => onSetDisabled(member.userId, false)}
            >
              <Undo2 size={16} />
              Give their seat back
            </Menu.Item>
          ) : (
            <Menu.Item
              value="disable"
              data-testid="members-row-disable"
              onClick={() => onSetDisabled(member.userId, true)}
            >
              <Ban size={16} />
              Take their seat away
            </Menu.Item>
          ))}
        {canDelete && (
          <Menu.Item
            value="delete"
            color="red.fg"
            data-testid="members-row-delete"
            onClick={onDelete}
          >
            <Trash2 size={16} />
            Remove from organization
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

/** A fast launcher: the first keystroke hands off to the invite drawer carrying it. */
function InlineInviteBox({ onStartTyping }: { onStartTyping: (email: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <Input
      value={value}
      size="sm"
      maxWidth="240px"
      placeholder="Invite by email…"
      aria-label="Invite a teammate by email"
      onChange={(event) => {
        const next = event.target.value;
        if (next.trim().length > 0) {
          onStartTyping(next);
          setValue("");
        } else {
          setValue(next);
        }
      }}
    />
  );
}

/** Why a member cannot sign in here, when they cannot. */
function MemberStatusChip({ member }: { member: Member }) {
  if (member.user.deactivatedAt) {
    return (
      <IdentityChip
        label="Deactivated"
        tone="warning"
        title="This account has been deactivated here. Your identity provider may still list them."
        data-testid="member-deactivated"
      />
    );
  }
  if (member.disabledAt) {
    return (
      <IdentityChip
        label="Disabled"
        tone="warning"
        title="Their access in this organization is switched off."
        data-testid="member-disabled"
      />
    );
  }
  return null;
}

/** One member, as the People list draws them. */
function MemberListRow({
  member,
  organizationId,
  provenance,
  department,
  departmentNameById,
  showDepartment,
  twoStep,
  canDisable,
  canDelete,
  onOpen,
  onSetDisabled,
  onRequestRemoval,
}: {
  member: Member;
  organizationId: string;
  provenance: Provenance;
  department: ReturnType<typeof useDepartmentColumn>;
  departmentNameById: Map<string, string>;
  showDepartment: boolean;
  twoStep: ReturnType<typeof useTwoStepRequirement>;
  canDisable: boolean;
  canDelete: boolean;
  onOpen: () => void;
  onSetDisabled: ReturnType<typeof useMemberDisableAction>["setMemberDisabled"];
  onRequestRemoval: (target: RemovalTarget) => void;
}) {
  return (
    <PersonIdentityRow
      name={member.user.name}
      address={member.user.email}
      image={member.user.image}
      muted={!!member.disabledAt}
      data-testid="member-row"
      onOpen={onOpen}
      badges={
        <>
          {member.role === "EXTERNAL" && (
            <Badge colorPalette="gray" size="sm">
              Lite Member
            </Badge>
          )}
          {member.role === "DEVELOPER" && (
            <Badge colorPalette="teal" size="sm">
              Developer
            </Badge>
          )}
          <MemberStatusChip member={member} />
        </>
      }
      chips={
        <>
          <ProvenanceChip provenance={provenance} />
          {department.show && (
            <DepartmentChip
              name={departmentNameById.get(department.byUser.get(member.userId) ?? "")}
            />
          )}
          {twoStep.show && (
            <SecondFactorCell
              member={twoStep.byUser.get(member.userId)}
              mfaRequired={twoStep.mfaRequired}
            />
          )}
        </>
      }
      trailing={
        <HStack gap={3}>
          {showDepartment && (
            <DepartmentPicker
              organizationId={organizationId}
              kind="user"
              entityId={member.userId}
              value={department.byUser.get(member.userId) ?? null}
              departments={department.departments}
              onAssigned={department.refetch}
            />
          )}
          <Text fontSize="sm" color="fg.muted" minWidth="90px" textAlign="right">
            {orgRoleLabel(member.role)}
          </Text>
          <MemberRowActions
            member={member}
            canDisable={canDisable}
            canDelete={canDelete}
            onOpen={onOpen}
            onSetDisabled={onSetDisabled}
            onDelete={() =>
              onRequestRemoval({
                userId: member.userId,
                label: member.user.name ?? member.user.email ?? "this member",
              })
            }
          />
        </HStack>
      }
    />
  );
}

/** The People tab's heading, seat meter and cut filter. Every cut carries its number, zero too. */
function PeopleHeader({
  organizationId,
  activePlan,
  canManage,
  cut,
  onSelectCut,
  memberCount,
  openInviteCount,
  requestCount,
  onInvite,
}: {
  organizationId: string;
  activePlan: PlanInfo;
  canManage: boolean;
  cut: PeopleCut;
  onSelectCut: (next: string) => void;
  memberCount: number;
  openInviteCount: number;
  requestCount: number;
  onInvite: ReturnType<typeof useDrawer>["openDrawer"];
}) {
  return (
    <>
      <SectionTitle
        title="People"
        hint="Everybody in this organization, and everybody on their way in."
        right={
          canManage ? (
            <HStack gap={2}>
              <InlineInviteBox
                onStartTyping={(email) =>
                  onInvite(InviteMemberDrawerToken, email ? { initialEmail: email } : undefined)
                }
              />
              <Button
                size="sm"
                colorPalette="orange"
                onClick={() => onInvite(InviteMemberDrawerToken)}
                data-testid="members-invite-open"
              >
                <Plus size={14} />
                Invite people
              </Button>
            </HStack>
          ) : null
        }
      />

      {canManage && <MemberSeatUsage organizationId={organizationId} activePlan={activePlan} />}

      <FilterChips
        value={cut}
        onChange={onSelectCut}
        groupLabel="Filter people by how they got here"
        countNoun={{ singular: "person", plural: "people" }}
        testId="people-cuts"
        items={peopleCutItems({ memberCount, openInviteCount, requestCount })}
      />
    </>
  );
}

/** The link for an invitation that has just been created. */
function InviteLinkDialog({
  open,
  invites,
  onClose,
}: {
  open: boolean;
  invites: { inviteCode: string; email: string }[];
  onClose: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={({ open }) => (open ? undefined : onClose())}>
      <Dialog.Content bg="bg">
        <Dialog.Header>
          <Dialog.Title textStyle="xl" fontWeight="semibold">
            Invite Link
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingBottom={6}>
          <VStack align="start" gap={4}>
            <Text>
              Send the link below to the users you want to invite to join the organization.
            </Text>

            <VStack align="start" gap={4} width="full">
              {invites.map((invite) => (
                <VStack key={invite.inviteCode} align="start" gap={6} width="full">
                  <Text fontWeight="600">{invite.email}</Text>
                  <CopyInput
                    value={`${window.location.origin}/invite/accept?inviteCode=${invite.inviteCode}`}
                    label="Invite Link"
                    marginTop={0}
                  />
                </VStack>
              ))}
            </VStack>
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** The list itself: members, invitations and join requests, filtered by cut. */
function PeopleRows({
  cut,
  organizationId,
  members,
  invites,
  openInvites,
  teams,
  canManage,
  provenance,
  department,
  departmentNameById,
  showDepartment,
  twoStep,
  joinRequests,
  canDeleteMember,
  canDisableMember,
  onOpenPerson,
  onSetDisabled,
  onRequestRemoval,
  onViewInviteLink,
  onResendInvite,
  onRevokeInvite,
}: {
  cut: PeopleCut;
  organizationId: string;
  members: Member[];
  invites: Invite[];
  openInvites: Invite[];
  teams: OrganizationTeamReading[];
  canManage: boolean;
  provenance: Record<string, Provenance> | undefined;
  department: ReturnType<typeof useDepartmentColumn>;
  departmentNameById: Map<string, string>;
  showDepartment: boolean;
  twoStep: ReturnType<typeof useTwoStepRequirement>;
  joinRequests: ReturnType<typeof useJoinRequests>;
  canDeleteMember: (memberId: string) => boolean;
  canDisableMember: (memberId: string) => boolean;
  onOpenPerson: (userId: string) => void;
  onSetDisabled: ReturnType<typeof useMemberDisableAction>["setMemberDisabled"];
  onRequestRemoval: (target: RemovalTarget) => void;
  onViewInviteLink: (inviteCode: string, email: string) => void;
  onResendInvite: ReturnType<typeof useInviteActions>["resendInvite"];
  onRevokeInvite: ReturnType<typeof useInviteActions>["revokeInvite"];
}) {
  const memberRows = peopleCutShows({ cut, list: "members" })
    ? members.map((member) => (
        <MemberListRow
          key={`member:${member.userId}`}
          member={member}
          organizationId={organizationId}
          provenance={provenance?.[member.userId]}
          department={department}
          departmentNameById={departmentNameById}
          showDepartment={showDepartment}
          twoStep={twoStep}
          canDisable={canDisableMember(member.userId)}
          canDelete={canDeleteMember(member.userId)}
          onOpen={() => onOpenPerson(member.userId)}
          onSetDisabled={onSetDisabled}
          onRequestRemoval={onRequestRemoval}
        />
      ))
    : [];

  const inviteRows = peopleCutShows({ cut, list: "invited" })
    ? (cut === "invited" ? invites : openInvites).map((invite) => (
        <InviteRow
          key={`invite:${invite.id}`}
          invite={invite}
          isAdmin={canManage}
          teams={teams}
          onViewInviteLink={onViewInviteLink}
          onResendInvite={onResendInvite}
          onRevokeInvite={onRevokeInvite}
        />
      ))
    : [];

  const requestRows = peopleCutShows({ cut, list: "waiting" })
    ? joinRequests.requests.map((request) => (
        <JoinRequestRow
          key={`request:${request.joinRequestId}`}
          request={request}
          isAdmin={canManage}
          answering={joinRequests.answeringId === request.joinRequestId}
          onApprove={joinRequests.approve}
          onReject={joinRequests.reject}
        />
      ))
    : [];

  return (
    <IdentityRowList data-testid="people-list" empty={emptyPeopleCutText(cut)}>
      {[...memberRows, ...inviteRows, ...requestRows]}
    </IdentityRowList>
  );
}

/** Invitations: the pending list, the actions on one, and the link dialog. */
function useInviteFlow({
  organization,
  activePlan,
}: {
  organization: OrganizationWithMembersAndTheirTeams;
  activePlan: PlanInfo;
}) {
  const {
    open: isInviteLinkOpen,
    onOpen: onInviteLinkOpen,
    onClose: onInviteLinkClose,
  } = useDisclosure();

  const pendingInvites = api.invite.getOrganizationPendingInvites.useQuery(
    { organizationId: organization.id },
    { enabled: !!organization.id },
  );

  const [selectedInvites, setSelectedInvites] = useState<{ inviteCode: string; email: string }[]>(
    [],
  );

  useEffect(() => {
    if (selectedInvites.length > 0) onInviteLinkOpen();
  }, [selectedInvites, onInviteLinkOpen]);

  const publicEnv = usePublicEnv();
  const hasEmailProvider = publicEnv.data?.HAS_EMAIL_PROVIDER_KEY;

  const { resendInvite, revokeInvite } = useInviteActions({
    organizationId: organization.id,
    hasEmailProvider: hasEmailProvider ?? false,
    onInviteCreated: setSelectedInvites,
    // Nothing to close: the invite flow is its own drawer.
    onClose: () => {},
    refetchInvites: () => void pendingInvites.refetch(),
    pricingModel: (organization as { pricingModel?: string }).pricingModel,
    activePlanFree: activePlan.free,
    activePlanType: activePlan.type,
    activePlanSource: activePlan.planSource,
  });

  const viewInviteLink = (inviteCode: string, email: string) => {
    setSelectedInvites([{ inviteCode, email }]);
    onInviteLinkOpen();
  };

  const onInviteModalClose = () => {
    setSelectedInvites([]);
    onInviteLinkClose();
  };

  return {
    isInviteLinkOpen,
    selectedInvites,
    pendingInvites,
    resendInvite,
    revokeInvite,
    viewInviteLink,
    onInviteModalClose,
  };
}

/** Which cut is showing, kept in the address; "all" stays out of it, and a change replaces. */
function useCutFromAddress() {
  const host = useOrganizationHost();
  const route = host.route();
  const cut = parsePeopleCut(route.query[PEOPLE_CUT_PARAM]);
  const selectCut = (next: string) =>
    host.setQuery(
      { ...route.query, [PEOPLE_CUT_PARAM]: next === "all" ? undefined : next },
      { replace: true },
    );
  return { cut, selectCut };
}

/**
 * Removing a member, and the gentler thing to do instead. The row menu's
 * removal waits on a confirmation, as the person drawer's always has.
 */
function useMemberRemoval(organizationId: string) {
  const toaster = useOrganizationToaster();
  const queryClient = api.useUtils();
  const deleteMemberMutation = api.organization.deleteMember.useMutation();
  const [confirmingRemoval, setConfirmingRemoval] = useState<RemovalTarget | null>(null);

  // Seat usage and the licence check read the same fact as the membership list.
  const invalidateMembership = (tags: Record<string, string>) => {
    void queryClient.organization.getOrganizationWithMembersAndTheirTeams
      .invalidate()
      .catch((error) => {
        reportUnexpected(error, tags);
      });
    void queryClient.organization.getDirectoryCounts.invalidate();
    void queryClient.limits.getUsage.invalidate();
    void queryClient.licenseEnforcement.checkLimit.invalidate();
  };

  const deleteMember = (userId: string) => {
    deleteMemberMutation.mutate(
      { organizationId, userId },
      {
        onSuccess: () => {
          toaster.create({
            title: "Member removed successfully",
            description: "The member has been removed from the organization.",
            type: "success",
            duration: 5000,
          });
          invalidateMembership({ userId, organizationId });
        },
        onError: () => {
          toaster.create({
            title: "Sorry, something went wrong",
            description: "Please try that again",
            type: "error",
            duration: 5000,
          });
        },
      },
    );
  };

  const { setMemberDisabled } = useMemberDisableAction({
    organizationId,
    onChanged: () => invalidateMembership({ organizationId }),
  });

  return {
    deleteMember,
    deleting: deleteMemberMutation.isPending,
    confirmingRemoval,
    setConfirmingRemoval,
    setMemberDisabled,
  };
}

/** The reads the list draws from, and who may act on whom. Each fails on its own. */
function usePeopleListReads({
  organization,
  canManage,
  userId,
  pendingInvites,
}: {
  organization: OrganizationWithMembersAndTheirTeams;
  canManage: boolean;
  userId: string | undefined;
  pendingInvites: { data: Invite[] | undefined };
}) {
  // Asked apart from the list: a failed read leaves everybody listed, without chips.
  const provenance = api.organization.getMemberProvenance.useQuery(
    { organizationId: organization.id },
    { enabled: !!organization.id && canManage },
  );

  const sortedMembers = useMemo(
    () =>
      [...organization.members].toSorted((a, b) =>
        (a.user.name ?? a.user.email ?? "").localeCompare(b.user.name ?? b.user.email ?? ""),
      ),
    [organization.members],
  );

  const canDeleteMember = (memberId: string) =>
    canManage && organization.members.length > 1 && memberId !== userId;

  // Disabling is reversible, so it stays available down to the last member;
  // the server refuses the cases that would strand the organization.
  const canDisableMember = (memberId: string) => canManage && memberId !== userId;

  const invites = useMemo(() => pendingInvites.data ?? [], [pendingInvites.data]);
  // Only the ones still waiting on somebody; a revoked one stays readable under its own cut.
  const openInvites = useMemo(
    () =>
      invites.filter(
        (invite) => invite.displayStatus === "PENDING" || invite.displayStatus === "EXPIRED",
      ),
    [invites],
  );

  const joinRequests = useJoinRequests({ organizationId: organization.id, canManage });
  const twoStep = useTwoStepRequirement({ organizationId: organization.id, canManage });

  return {
    provenance,
    sortedMembers,
    canDeleteMember,
    canDisableMember,
    invites,
    openInvites,
    joinRequests,
    twoStep,
  };
}
