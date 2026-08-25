import {
  Badge,
  Button,
  Heading,
  HStack,
  Input,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Ban, MoreVertical, Plus, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { IdentityRow, IdentityRowList } from "~/components/access/IdentityRow";
import { ProvenanceChip } from "~/components/access/ProvenanceChip";
import { CopyInput } from "~/components/CopyInput";
import { AutomaticJoinsNotice } from "~/components/members/AutomaticJoinsNotice";
import { InviteRow } from "~/components/members/InvitesTable";
import { JoinRequestRow } from "~/components/members/JoinRequestsTable";
import { SecondFactorCell } from "~/components/members/SecondFactorCell";
import { useJoinRequests } from "~/components/members/useJoinRequests";
import { useTwoStepRequirement } from "~/components/members/useTwoStepRequirement";
import { DepartmentPicker } from "~/components/settings/DepartmentPicker";
import { SectionTitle } from "~/components/settings/kit/SettingRow";
import { SettingsRowsSkeleton } from "~/components/settings/kit/SettingsSkeleton";
import { MemberSeatUsage } from "~/components/settings/MemberSeatUsage";
import { orgRoleOptions } from "~/components/settings/OrganizationUserRoleField";
import { SectionErrorNotice } from "~/components/settings/SectionErrorNotice";
import { useDepartmentColumn } from "~/components/settings/useDepartmentColumn";
import { Dialog } from "~/components/ui/dialog";
import { FilterChips } from "~/components/ui/FilterChips";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import type { OrganizationUserRole } from "~/generated/prisma/client";
import { useDrawer } from "~/hooks/useDrawer";
import { useInviteActions } from "~/hooks/useInviteActions";
import { useMemberDisableAction } from "~/hooks/useMemberDisableAction";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import type {
  OrganizationWithMembersAndTheirTeams,
  TeamWithProjects,
} from "~/server/app-layer/organizations/repositories/organization.repository";
import { api } from "~/utils/api";
import { captureException } from "~/utils/posthogErrorCapture";
import type { PlanInfo } from "../../../ee/licensing/planInfo";

/**
 * Everybody in the organization, at whatever distance from the door they are
 * standing (D05, D11, D12).
 *
 * THREE CUTS OF ONE LIST, NOT THREE LISTS. A member, somebody invited and
 * somebody asking to join are the same person three steps apart, and they were
 * three tabs so that each could carry a count. Chips carry a count just as
 * well and keep everybody in one table, which is what makes "who is here" one
 * read instead of three — and it frees the tab bar above for the things that
 * genuinely are different subjects: teams, groups, the provisioning
 * credential.
 *
 * Every row is the same `IdentityRow` whatever the person's distance, so
 * somebody mid-flight looks like the person they will become rather than like
 * a different kind of object. Only the trailing controls differ, because only
 * the available acts differ.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */

/** The cuts, in the order somebody arrives through them. */
const CUTS = ["all", "members", "invited", "waiting"] as const;
type Cut = (typeof CUTS)[number];

/** Which cut is open lives in the address, so a link opens where it was sent
 *  from — "there are three people waiting" has to land on the three. */
const CUT_PARAM = "people";

export function PeopleSection({ organizationId }: { organizationId: string }) {
  const { organization } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });

  const organizationWithMembers =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      { organizationId, includeDeactivated: true },
      { enabled: !!organizationId },
    );
  const activePlan = api.plan.getActivePlan.useQuery(
    { organizationId },
    { enabled: !!organizationId },
  );

  if (organizationWithMembers.isError) {
    return (
      <SectionErrorNotice
        error={organizationWithMembers.error}
        fallbackTitle="Couldn't load your members"
      />
    );
  }

  // The shape of this list is known before its contents are — a row per
  // person, with a mark, a name over an address, and controls at the end. A
  // spinner throws that away and makes the tab arrive empty and then jump.
  if (!organizationWithMembers.data || !activePlan.data)
    return <SettingsRowsSkeleton rows={5} />;

  return (
    <PeopleList
      organization={organizationWithMembers.data}
      teams={organization?.teams ?? []}
      activePlan={activePlan.data}
    />
  );
}

function PeopleList({
  organization,
  teams,
  activePlan,
}: {
  organization: OrganizationWithMembersAndTheirTeams;
  teams: TeamWithProjects[];
  activePlan: PlanInfo;
}) {
  const { data: session } = useRequiredSession();
  const { hasPermission } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });
  const canManage = hasPermission("organization:manage");
  const user = session?.user;

  const department = useDepartmentColumn(organization.id);
  const showDepartment = department.show && canManage;

  const queryClient = api.useUtils();
  const { openDrawer } = useDrawer();

  const [searchParams, setSearchParams] = useSearchParams();
  const rawCut = searchParams.get(CUT_PARAM);
  const cut: Cut = CUTS.includes(rawCut as Cut) ? (rawCut as Cut) : "all";
  const selectCut = (next: string) =>
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        // Everybody is the default, so it stays out of the address entirely.
        if (next === "all") params.delete(CUT_PARAM);
        else params.set(CUT_PARAM, next);
        return params;
      },
      { replace: true },
    );

  const {
    open: isInviteLinkOpen,
    onOpen: onInviteLinkOpen,
    onClose: onInviteLinkClose,
  } = useDisclosure();

  const pendingInvites =
    api.organization.getOrganizationPendingInvites.useQuery(
      { organizationId: organization.id },
      { enabled: !!organization.id },
    );

  const [selectedInvites, setSelectedInvites] = useState<
    { inviteCode: string; email: string }[]
  >([]);

  useEffect(() => {
    if (selectedInvites.length > 0) onInviteLinkOpen();
  }, [selectedInvites, onInviteLinkOpen]);

  const publicEnv = usePublicEnv();
  const hasEmailProvider = publicEnv.data?.HAS_EMAIL_PROVIDER_KEY;

  const { resendInvite, revokeInvite } = useInviteActions({
    organizationId: organization.id,
    hasEmailProvider: hasEmailProvider ?? false,
    onInviteCreated: setSelectedInvites,
    onClose: () => {
      // Nothing to close: the invite flow is its own drawer.
    },
    refetchInvites: () => void pendingInvites.refetch(),
    pricingModel: (organization as { pricingModel?: string }).pricingModel,
    activePlanFree: activePlan.free,
    activePlanType: activePlan.type,
    activePlanSource: activePlan.planSource,
  });

  const deleteMemberMutation = api.organization.deleteMember.useMutation();

  const deleteMember = (userId: string) => {
    deleteMemberMutation.mutate(
      { organizationId: organization.id, userId },
      {
        onSuccess: () => {
          toaster.create({
            title: "Member removed successfully",
            description: "The member has been removed from the organization.",
            type: "success",
            duration: 5000,
          });
          void queryClient.organization.getOrganizationWithMembersAndTheirTeams
            .invalidate()
            .catch((error) => {
              captureException(error, {
                tags: { userId, organizationId: organization.id },
              });
            });
          void queryClient.limits.getUsage.invalidate();
          void queryClient.licenseEnforcement.checkLimit.invalidate();
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
    organizationId: organization.id,
    onChanged: () => {
      void queryClient.organization.getOrganizationWithMembersAndTheirTeams
        .invalidate()
        .catch((error) => {
          captureException(error, {
            tags: { organizationId: organization.id },
          });
        });
      void queryClient.limits.getUsage.invalidate();
      void queryClient.licenseEnforcement.checkLimit.invalidate();
    },
  });

  const viewInviteLink = (inviteCode: string, email: string) => {
    setSelectedInvites([{ inviteCode, email }]);
    onInviteLinkOpen();
  };

  const onInviteModalClose = () => {
    setSelectedInvites([]);
    onInviteLinkClose();
  };

  /**
   * Why each person is here. A second query on purpose: the list must never
   * wait on it, and a provenance read that fails leaves every row without a
   * chip rather than leaving the page without rows.
   */
  const provenance = api.organization.getMemberProvenance.useQuery(
    { organizationId: organization.id },
    { enabled: !!organization.id && canManage },
  );

  const sortedMembers = useMemo(
    () =>
      [...organization.members].sort((a, b) =>
        (a.user.name ?? a.user.email ?? "").localeCompare(
          b.user.name ?? b.user.email ?? "",
        ),
      ),
    [organization.members],
  );

  const canDeleteMember = (memberId: string) =>
    canManage && organization.members.length > 1 && memberId !== user?.id;

  // Unlike deleting, disabling is reversible and is how an organization gets
  // back within its licensed seats, so it stays available down to the last
  // member. The server refuses the cases that would strand the org.
  const canDisableMember = (memberId: string) =>
    canManage && memberId !== user?.id;

  const invites = useMemo(
    () => pendingInvites.data ?? [],
    [pendingInvites.data],
  );
  /** Only the ones still waiting on somebody are a person on the way in. A
   *  revoked invitation is a record, and it stays readable under its own cut. */
  const openInvites = useMemo(
    () =>
      invites.filter(
        (invite) =>
          invite.displayStatus === "PENDING" ||
          invite.displayStatus === "EXPIRED",
      ),
    [invites],
  );

  const joinRequests = useJoinRequests({
    organizationId: organization.id,
    canManage,
  });

  // What a person can prove is a fact about them and stays beside them; the
  // REQUIREMENT is a condition of signing in and lives on Authentication.
  const twoStep = useTwoStepRequirement({
    organizationId: organization.id,
    canManage,
  });

  const memberRows =
    cut === "all" || cut === "members"
      ? sortedMembers.map((member) => (
          <IdentityRow
            key={`member:${member.userId}`}
            id={member.userId}
            name={member.user.name}
            address={member.user.email}
            image={member.user.image}
            muted={!!member.disabledAt}
            data-testid="member-row"
            onOpen={() => openDrawer("person", { userId: member.userId })}
            badges={
              <>
                {member.role === "EXTERNAL" && (
                  <Badge colorPalette="gray" size="sm">
                    Lite Member
                  </Badge>
                )}
                {member.user.deactivatedAt && (
                  <Badge colorPalette="red" size="sm">
                    Deactivated
                  </Badge>
                )}
                {member.disabledAt && (
                  <Badge colorPalette="orange" size="sm">
                    Disabled
                  </Badge>
                )}
              </>
            }
            chips={
              <>
                <ProvenanceChip provenance={provenance.data?.[member.userId]} />
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
                    organizationId={organization.id}
                    kind="user"
                    entityId={member.userId}
                    value={department.byUser.get(member.userId) ?? null}
                    departments={department.departments}
                    onAssigned={department.refetch}
                  />
                )}
                <Text
                  fontSize="sm"
                  color="fg.muted"
                  minWidth="90px"
                  textAlign="right"
                >
                  {orgRoleLabel(member.role)}
                </Text>
                <MemberRowActions
                  member={member}
                  canDisable={canDisableMember(member.userId)}
                  canDelete={canDeleteMember(member.userId)}
                  onOpen={() => openDrawer("person", { userId: member.userId })}
                  onSetDisabled={setMemberDisabled}
                  onDelete={deleteMember}
                />
              </HStack>
            }
          />
        ))
      : [];

  const inviteRows =
    cut === "all" || cut === "invited"
      ? (cut === "invited" ? invites : openInvites).map((invite) => (
          <InviteRow
            key={`invite:${invite.id}`}
            invite={invite}
            isAdmin={canManage}
            teams={teams}
            onViewInviteLink={viewInviteLink}
            onResendInvite={resendInvite}
            onRevokeInvite={revokeInvite}
          />
        ))
      : [];

  const requestRows =
    cut === "all" || cut === "waiting"
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
    <>
      <VStack align="stretch" gap={4} width="full">
        {/* THE TAB'S OWN ACTION, WHERE EVERY TAB PUTS IT: at the end of the
            first heading row. Four tabs that each placed their action
            somewhere else read as four products. */}
        <SectionTitle
          title="People"
          hint="Everybody in this organization, and everybody on their way in."
          right={
            canManage ? (
              <HStack gap={2}>
                <InlineInviteBox
                  onStartTyping={(email) =>
                    openDrawer(
                      "inviteMember",
                      email ? { initialEmail: email } : undefined,
                    )
                  }
                />
                <Button
                  size="sm"
                  colorPalette="orange"
                  onClick={() => openDrawer("inviteMember")}
                >
                  <Plus size={14} />
                  Invite people
                </Button>
              </HStack>
            ) : null
          }
        />

        {canManage && (
          <MemberSeatUsage
            organizationId={organization.id}
            activePlan={activePlan}
          />
        )}

        {/* A ZERO IS AN ANSWER. Every cut carries its number whether or not
            there is anything behind it — somebody checking on a quiet week
            came here to read exactly that. */}
        <FilterChips
          value={cut}
          onChange={selectCut}
          groupLabel="Filter people by how they got here"
          countNoun={{ singular: "person", plural: "people" }}
          testId="people-cuts"
          items={[
            {
              value: "all",
              label: "Everybody",
              count:
                sortedMembers.length +
                openInvites.length +
                joinRequests.requests.length,
            },
            { value: "members", label: "Members", count: sortedMembers.length },
            {
              value: "invited",
              label: "Invited",
              count: pendingInvites.data ? openInvites.length : 0,
            },
            {
              value: "waiting",
              label: "Waiting to join",
              count: joinRequests.requests.length,
            },
          ]}
        />

        {provenance.isError && (
          <SectionErrorNotice
            error={provenance.error}
            fallbackTitle="Couldn't work out why each person is here"
          />
        )}

        {pendingInvites.isError && (
          <SectionErrorNotice
            error={pendingInvites.error}
            fallbackTitle="Couldn't load your invitations"
          />
        )}

        {/* Who walked in without anybody approving, above the list they are
            in. Only where somebody is actually looking at the joiners. */}
        {(cut === "all" || cut === "waiting") && (
          <AutomaticJoinsNotice joins={joinRequests.automaticJoins} />
        )}

        <IdentityRowList data-testid="people-list" empty={emptyTextFor(cut)}>
          {[...memberRows, ...inviteRows, ...requestRows]}
        </IdentityRowList>
      </VStack>

      <Dialog.Root
        open={isInviteLinkOpen}
        onOpenChange={({ open }) => (open ? undefined : onInviteModalClose())}
      >
        <Dialog.Content bg="bg">
          <Dialog.Header>
            <Dialog.Title>
              <Heading>Invite Link</Heading>
            </Dialog.Title>
          </Dialog.Header>
          <Dialog.CloseTrigger />
          <Dialog.Body paddingBottom={6}>
            <VStack align="start" gap={4}>
              <Text>
                Send the link below to the users you want to invite to join the
                organization.
              </Text>

              <VStack align="start" gap={4} width="full">
                {selectedInvites.map((invite) => (
                  <VStack
                    key={invite.inviteCode}
                    align="start"
                    gap={6}
                    width="full"
                  >
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
    </>
  );
}

/**
 * What an empty cut says. Never the same sentence for all four: "nobody is
 * waiting to join" and "nobody has an outstanding invitation" are different
 * facts, and the generic one leaves a reader unsure which they are being told.
 */
function emptyTextFor(cut: Cut): string {
  if (cut === "invited") return "Nobody has an outstanding invitation.";
  if (cut === "waiting")
    return "Nobody is waiting to join. People with a verified address on your domain can ask, if your joining policy allows it.";
  if (cut === "members") return "Nobody is a member of this organization yet.";
  return "Nobody is here yet, and nobody is on their way in.";
}

/** The seat a member holds, in the words the role picker uses. */
function orgRoleLabel(role: OrganizationUserRole): string {
  return orgRoleOptions.find((option) => option.value === role)?.label ?? role;
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
  member: {
    userId: string;
    role: OrganizationUserRole;
    disabledAt: Date | null;
    user: { name: string | null; email: string | null };
  };
  canDisable: boolean;
  canDelete: boolean;
  onOpen: () => void;
  onSetDisabled: (userId: string, disabled: boolean) => void;
  onDelete: (userId: string) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Actions for ${member.user.name ?? member.user.email ?? "this member"}`}
        >
          <MoreVertical size={16} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item value="open" onClick={onOpen}>
          Open
        </Menu.Item>
        {canDisable &&
          (member.disabledAt ? (
            <Menu.Item
              value="enable"
              onClick={() => onSetDisabled(member.userId, false)}
            >
              <Undo2 size={16} />
              Give their seat back
            </Menu.Item>
          ) : (
            <Menu.Item
              value="disable"
              onClick={() => onSetDisabled(member.userId, true)}
            >
              <Ban size={16} />
              Take their seat away
            </Menu.Item>
          ))}
        {canDelete && (
          <Menu.Item
            value="delete"
            color="red.500"
            onClick={() => onDelete(member.userId)}
          >
            <Trash2 size={16} />
            Remove from organization
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

/**
 * Inline invite box: the moment someone starts typing an email here, hand off
 * to the invite drawer carrying what they typed, so the box is a fast launcher
 * rather than a second, competing invite form.
 */
function InlineInviteBox({
  onStartTyping,
}: {
  onStartTyping: (email: string) => void;
}) {
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
