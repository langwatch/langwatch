import {
  Badge,
  Button,
  Heading,
  HStack,
  Input,
  Spacer,
  Spinner,
  Tabs,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Ban, MoreVertical, Plus, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { IdentityRow, IdentityRowList } from "~/components/access/IdentityRow";
import { ProvenanceChip } from "~/components/access/ProvenanceChip";
import { TabCount } from "~/components/settings/TabCount";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import type { OrganizationUserRole } from "~/generated/prisma/client";
import { useDrawer } from "~/hooks/useDrawer";
import { useMemberDisableAction } from "~/hooks/useMemberDisableAction";
import { captureException } from "~/utils/posthogErrorCapture";
import type { PlanInfo } from "../../../ee/licensing/planInfo";
import { CopyInput } from "../../components/CopyInput";
import { AutomaticJoinsNotice } from "../../components/members/AutomaticJoinsNotice";
import { InvitesTable } from "../../components/members/InvitesTable";
import { JoinRequestsTable } from "../../components/members/JoinRequestsTable";
import { SecondFactorCell } from "../../components/members/SecondFactorCell";
import { useJoinRequests } from "../../components/members/useJoinRequests";
import { useTwoStepRequirement } from "../../components/members/useTwoStepRequirement";
import SettingsLayout from "../../components/SettingsLayout";
import { DepartmentPicker } from "../../components/settings/DepartmentPicker";
import { MemberSeatUsage } from "../../components/settings/MemberSeatUsage";
import { orgRoleOptions } from "../../components/settings/OrganizationUserRoleField";
import { SectionErrorNotice } from "../../components/settings/SectionErrorNotice";
import { useDepartmentColumn } from "../../components/settings/useDepartmentColumn";
import { Dialog } from "../../components/ui/dialog";
import { Menu } from "../../components/ui/menu";
import { toaster } from "../../components/ui/toaster";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useInviteActions } from "../../hooks/useInviteActions";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import type {
  OrganizationWithMembersAndTheirTeams,
  TeamWithProjects,
} from "../../server/app-layer/organizations/repositories/organization.repository";
import { api } from "../../utils/api";

/**
 * The people of an organization, in three tabs (D05, D11, D12).
 *
 * The page used to be everything at once: the member table, the invitations,
 * the requests to join, the second-factor requirement, the domain policy and
 * the seat count, stacked down one scroll. Two of those are POLICY — rules
 * about who may become a member — and they moved to /settings/access, where
 * a rule is not mistaken for a person. What is left here is people, and the
 * three tabs are the three states a person can be in: here, invited, or
 * asking.
 *
 * Every one of the three lists the same identity row, so a person mid-flight
 * looks like the person they will become rather than like a different kind of
 * object.
 */
const TABS = ["members", "invitations", "requests"] as const;
type MembersTab = (typeof TABS)[number];

function Members() {
  const { organization } = useOrganizationTeamProject();

  const organizationWithMembers =
    api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
      {
        organizationId: organization?.id ?? "",
        includeDeactivated: true,
      },
      { enabled: !!organization },
    );
  const activePlan = api.plan.getActivePlan.useQuery(
    {
      organizationId: organization?.id ?? "",
    },
    {
      enabled: !!organization,
    },
  );

  if (!organization) return <SettingsLayout />;

  if (organizationWithMembers.isError) {
    return (
      <SettingsLayout>
        <SectionErrorNotice
          error={organizationWithMembers.error}
          fallbackTitle="Couldn't load your members"
        />
      </SettingsLayout>
    );
  }

  if (!organizationWithMembers.data || !activePlan.data)
    return (
      <SettingsLayout>
        <Spinner />
      </SettingsLayout>
    );

  return (
    <MembersList
      teams={organization.teams}
      organization={organizationWithMembers.data}
      activePlan={activePlan.data}
    />
  );
}

export default withPermissionGuard("organization:manage", {
  layoutComponent: SettingsLayout,
})(Members);

function MembersList({
  organization,
  teams,
  activePlan,
}: {
  organization: OrganizationWithMembersAndTheirTeams;
  teams: TeamWithProjects[];
  activePlan: PlanInfo;
}) {
  const { data: session } = useRequiredSession();
  const { hasPermission } = useOrganizationTeamProject();
  const hasOrganizationManagePermission = hasPermission("organization:manage");
  const user = session?.user;

  const department = useDepartmentColumn(organization.id);
  const showDepartment = department.show && hasOrganizationManagePermission;

  const queryClient = api.useUtils();

  // Which tab is open lives in the address: an administrator sending a
  // colleague "there are three people waiting" needs the link to open on the
  // requests, not on the members.
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab: MembersTab = TABS.includes(rawTab as MembersTab)
    ? (rawTab as MembersTab)
    : "members";
  const selectTab = (next: string) =>
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        // Members is the default, so it stays out of the address entirely.
        if (next === "members") params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: true },
    );

  const { openDrawer } = useDrawer();

  const {
    open: isInviteLinkOpen,
    onOpen: onInviteLinkOpen,
    onClose: onInviteLinkClose,
  } = useDisclosure();

  const pendingInvites =
    api.organization.getOrganizationPendingInvites.useQuery(
      {
        organizationId: organization?.id ?? "",
      },
      { enabled: !!organization },
    );

  const [selectedInvites, setSelectedInvites] = useState<
    { inviteCode: string; email: string }[]
  >([]);

  useEffect(() => {
    if (selectedInvites.length > 0) {
      onInviteLinkOpen();
    }
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
      {
        organizationId: organization.id,
        userId,
      },
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
                tags: {
                  userId,
                  organizationId: organization.id,
                },
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
    { enabled: !!organization.id && hasOrganizationManagePermission },
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
    hasOrganizationManagePermission &&
    organization.members.length > 1 &&
    memberId !== user?.id;

  // Unlike deleting, disabling is reversible and is how an organization gets
  // back within its licensed seats, so it stays available down to the last
  // member. The server refuses the cases that would strand the org (the last
  // admin, or re-enabling past the seat count).
  const canDisableMember = (memberId: string) =>
    hasOrganizationManagePermission && memberId !== user?.id;

  const invites = useMemo(
    () => pendingInvites.data ?? [],
    [pendingInvites.data],
  );
  /** Only the ones still waiting on somebody count on the tab. */
  const openInviteCount = invites.filter(
    (invite) =>
      invite.displayStatus === "PENDING" || invite.displayStatus === "EXPIRED",
  ).length;

  const joinRequests = useJoinRequests({
    organizationId: organization.id,
    canManage: hasOrganizationManagePermission,
  });

  // The second-factor column, where the deployment offers one at all. The
  // REQUIREMENT itself now lives on /settings/access; what a person can
  // prove is a fact about them and stays beside them.
  const twoStep = useTwoStepRequirement({
    organizationId: organization.id,
    canManage: hasOrganizationManagePermission,
  });

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <HStack width="full">
          <Heading>Members</Heading>
          <Spacer />
          {hasOrganizationManagePermission && (
            <HStack gap={2}>
              <InlineInviteBox
                onStartTyping={(email) =>
                  openDrawer(
                    "inviteMember",
                    email ? { initialEmail: email } : undefined,
                  )
                }
              />
              <PageLayout.HeaderButton
                onClick={() => openDrawer("inviteMember")}
              >
                <Plus size={20} />
                Add members
              </PageLayout.HeaderButton>
            </HStack>
          )}
        </HStack>

        {hasOrganizationManagePermission && (
          <MemberSeatUsage
            organizationId={organization.id}
            activePlan={activePlan}
          />
        )}

        <Tabs.Root
          value={tab}
          onValueChange={(event) => selectTab(event.value)}
          colorPalette="blue"
          width="full"
        >
          {/* ONE RULE FOR ALL THREE. Invitations carried its count in
              parentheses whether or not there was anything to count, join
              requests carried none until something arrived, and members
              carried none at all — three lists in one row, labelled three
              ways. A zero is an answer here, and it is the answer somebody
              checking on a quiet week came to read. */}
          <Tabs.List marginBottom={4}>
            {/* The explicit space is not decoration. A flex container drops
                whitespace-only children from layout but keeps them in the
                text the accessible name is computed from — so without it the
                tab announces as "Invitations2", one run-together token. */}
            <Tabs.Trigger value="members" gap={2}>
              Members <TabCount value={sortedMembers.length} />
            </Tabs.Trigger>
            <Tabs.Trigger value="invitations" gap={2}>
              Invitations{" "}
              <TabCount
                value={pendingInvites.data ? openInviteCount : undefined}
              />
            </Tabs.Trigger>
            <Tabs.Trigger value="requests" gap={2}>
              Join requests <TabCount value={joinRequests.requests.length} />
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="members">
            <VStack align="stretch" gap={4} width="full">
              {provenance.isError && (
                <SectionErrorNotice
                  error={provenance.error}
                  fallbackTitle="Couldn't work out why each person is here"
                />
              )}
              <IdentityRowList
                data-testid="members-list"
                empty="Nobody is a member of this organization yet."
              >
                {sortedMembers.map((member) => (
                  <IdentityRow
                    key={member.userId}
                    id={member.userId}
                    name={member.user.name}
                    address={member.user.email}
                    image={member.user.image}
                    muted={!!member.disabledAt}
                    data-testid="member-row"
                    onOpen={() =>
                      openDrawer("person", { userId: member.userId })
                    }
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
                        <ProvenanceChip
                          provenance={provenance.data?.[member.userId]}
                        />
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
                          onOpen={() =>
                            openDrawer("person", { userId: member.userId })
                          }
                          onSetDisabled={setMemberDisabled}
                          onDelete={deleteMember}
                        />
                      </HStack>
                    }
                  />
                ))}
              </IdentityRowList>
            </VStack>
          </Tabs.Content>

          <Tabs.Content value="invitations">
            {pendingInvites.isError ? (
              <SectionErrorNotice
                error={pendingInvites.error}
                fallbackTitle="Couldn't load your invitations"
              />
            ) : (
              <InvitesTable
                invites={invites}
                isAdmin={hasOrganizationManagePermission}
                teams={teams}
                onViewInviteLink={viewInviteLink}
                onResendInvite={resendInvite}
                onRevokeInvite={revokeInvite}
              />
            )}
          </Tabs.Content>

          <Tabs.Content value="requests">
            <VStack align="stretch" gap={4} width="full">
              {/* Who walked in without anybody approving, in the same tab as
                  the people still waiting to be let in. */}
              <AutomaticJoinsNotice joins={joinRequests.automaticJoins} />
              <JoinRequestsTable
                requests={joinRequests.requests}
                isAdmin={hasOrganizationManagePermission}
                answeringId={joinRequests.answeringId}
                onApprove={joinRequests.approve}
                onReject={joinRequests.reject}
              />
            </VStack>
          </Tabs.Content>
        </Tabs.Root>
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
      {/* The "Add members" flow itself is the URL-routed invite drawer
          (registry key "inviteMember"), and one person is the "person"
          drawer — both rendered by <CurrentDrawer />. */}
    </SettingsLayout>
  );
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
