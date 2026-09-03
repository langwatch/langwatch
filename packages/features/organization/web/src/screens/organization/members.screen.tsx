/**
 * The people in an organization, at `/settings/members`.
 *
 * ONE TABLE AND THREE LISTS BESIDE IT: the members, the invitations that have
 * not been accepted, the requests from the organization's own verified domain,
 * and the domain-join setting that decides whether those requests happen at
 * all.
 *
 * A SEAT IS FREED TWO WAYS, and the difference is the whole point of having
 * both: removing a member is permanent, and disabling one is reversible while
 * still releasing the licence seat. Both invalidate the licence check and the
 * usage read, which is what the seat banner elsewhere counts.
 *
 * WHEN THE DEPLOYMENT CANNOT SEND EMAIL the page offers the invitation LINK
 * instead of claiming a message went out — the honest failure, not a silent one.
 *
 * The screen carries no chrome: the settings frame is applied by whichever
 * application serves the address.
 */

// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Input,
  Spacer,
  Table,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Ban, MoreVertical, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { OverflownTextWithTooltip } from "../../ui/elements/overflown-text";
import { RandomColorAvatar } from "../../ui/elements/random-color-avatar";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { type OrganizationUserRole, RoleBindingScopeType } from "../../model/prisma-types";
import { useDrawer } from "../../behavior/use-drawer";
import { useMemberDisableAction } from "../../behavior/use-member-disable-action";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { CopyInput } from "../../ui/elements/copy-input";
import { DomainJoinCard } from "../../ui/blocks/domain-join-card";
import { InvitesTable } from "../../ui/blocks/invites-table";
import { JoinRequestsTable } from "../../ui/blocks/join-requests-table";
import { useJoinRequests } from "../../behavior/use-join-requests";
import { DepartmentPicker } from "../../ui/elements/department-picker";
import { MemberDetailDialog } from "../../ui/sections/member-detail-dialog";
import { MemberSeatUsage } from "../../ui/elements/member-seat-usage";
import { useDepartmentColumn } from "../../behavior/use-department-column";
import { Dialog } from "@langwatch/design-system/dialog";
import { Menu } from "@langwatch/design-system/menu";
import { useInviteActions } from "../../behavior/use-invite-actions";
import type { OrganizationWithMembersAndTheirTeams } from "../../behavior/organization-api";
import { useOrganizationHost, type OrganizationTeamReading } from "../../model/organization-host";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { usePublicEnv } from "../../behavior/use-public-env";
import { useRequiredSession } from "../../behavior/use-required-session";
import type { RouterOutputs } from "../../behavior/organization-api";
import { api } from "../../behavior/organization-api";
import { useOrganizationToaster } from "../../behavior/organization-feedback";
import { reportUnexpected } from "../../behavior/report-unexpected";

type Binding = RouterOutputs["roleBinding"]["listForOrg"][number];

/** The grant the platform page asked for, unchanged. */
export const MEMBERS_PAGE_PERMISSION = "organization:manage";

export default function MembersScreen() {
  const { organization } = useOrganizationTeamProject();

  const organizationWithMembers = api.organization.getOrganizationWithMembersAndTheirTeams.useQuery(
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

  if (!organization || !organizationWithMembers.data || !activePlan.data) return null;

  return (
    <MembersList
      teams={organization.teams}
      organization={organizationWithMembers.data}
      activePlan={activePlan.data}
    />
  );
}

function MembersList({
  organization,
  teams,
  activePlan,
}: {
  organization: OrganizationWithMembersAndTheirTeams;
  teams: OrganizationTeamReading[];
  activePlan: PlanInfo;
}) {
  const toaster = useOrganizationToaster();
  const { data: session } = useRequiredSession();
  const { hasPermission } = useOrganizationTeamProject();
  const hasOrganizationManagePermission = hasPermission("organization:manage");
  const user = session?.user;

  const governanceEnabled = useOrganizationHost().isFeatureEnabled(
    "release_ui_ai_governance_enabled",
  );
  const department = useDepartmentColumn(organization.id, governanceEnabled);
  const showDepartment = department.show && hasOrganizationManagePermission;

  const queryClient = api.useUtils();

  const [selectedMember, setSelectedMember] = useState<{
    userId: string;
    role: OrganizationUserRole;
    user: { name: string | null; email: string | null };
  } | null>(null);

  // "Add members" is now a URL-routed drawer (see drawers.md), openable from
  // here, the command bar, and the inline invite box below.
  const { openDrawer } = useDrawer();

  const {
    open: isInviteLinkOpen,
    onOpen: onInviteLinkOpen,
    onClose: onInviteLinkClose,
  } = useDisclosure();

  const pendingInvites = api.organization.getOrganizationPendingInvites.useQuery(
    {
      organizationId: organization?.id ?? "",
    },
    { enabled: !!organization },
  );
  const deleteMemberMutation = api.organization.deleteMember.useMutation();

  const [selectedInvites, setSelectedInvites] = useState<{ inviteCode: string; email: string }[]>(
    [],
  );

  // Watch for changes in selectedInvites and open popup when it changes
  useEffect(() => {
    if (selectedInvites.length > 0) {
      onInviteLinkOpen();
    }
  }, [selectedInvites, onInviteLinkOpen]);

  const publicEnv = usePublicEnv();
  const hasEmailProvider = publicEnv.data?.HAS_EMAIL_PROVIDER_KEY;

  // The add-member flow (create invites) now lives in the invite drawer; the
  // page keeps these handlers for the invites table's resend / revoke.
  const { resendInvite, revokeInvite } = useInviteActions({
    organizationId: organization.id,
    hasEmailProvider: hasEmailProvider ?? false,
    onInviteCreated: setSelectedInvites,
    onClose: () => {},
    refetchInvites: () => void pendingInvites.refetch(),
    pricingModel: (organization as { pricingModel?: string }).pricingModel,
    activePlanFree: activePlan.free,
    activePlanType: activePlan.type,
    activePlanSource: activePlan.planSource,
  });

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
              reportUnexpected(error, {
                userId,
                organizationId: organization.id,
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
          reportUnexpected(error, { organizationId: organization.id });
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

  const {
    data: allBindings,
    isLoading: isBindingsLoading,
    isError: isBindingsError,
  } = api.roleBinding.listForOrg.useQuery(
    { organizationId: organization.id },
    { enabled: !!organization.id && hasOrganizationManagePermission },
  );

  const bindingsByUser = useMemo(() => {
    const map = new Map<string, Binding[]>();
    for (const b of allBindings ?? []) {
      if (b.userId) {
        if (!map.has(b.userId)) map.set(b.userId, []);
        map.get(b.userId)!.push(b);
      }
      for (const uid of b.memberUserIds) {
        if (!map.has(uid)) map.set(uid, []);
        map.get(uid)!.push(b);
      }
    }
    return map;
  }, [allBindings]);

  const sortedMembers = useMemo(
    () =>
      [...organization.members].sort((a, b) =>
        (a.user.name ?? a.user.email ?? "").localeCompare(b.user.name ?? b.user.email ?? ""),
      ),
    [organization.members],
  );

  const canDeleteMember = (memberId: string) =>
    hasOrganizationManagePermission && organization.members.length > 1 && memberId !== user?.id;

  // Unlike deleting, disabling is reversible and is how an organization gets
  // back within its licensed seats, so it stays available down to the last
  // member. The server refuses the cases that would strand the org (the last
  // admin, or re-enabling past the seat count).
  const canDisableMember = (memberId: string) =>
    hasOrganizationManagePermission && memberId !== user?.id;

  const invites = useMemo(() => pendingInvites.data ?? [], [pendingInvites.data]);

  // One panel, two directions (D12): an invitation is the organization
  // reaching out, a request is somebody reaching in, and an admin answers
  // both in the same place. Renders nothing when nothing is waiting — which
  // is also what the flag being off looks like from here.
  const joinRequests = useJoinRequests({
    organizationId: organization.id,
    canManage: hasOrganizationManagePermission,
  });

  return (
    <>
      <VStack gap={6} width="full" align="start">
        <HStack width="full">
          <Heading>Organization Members</Heading>
          <Spacer />
          {hasOrganizationManagePermission && (
            <HStack gap={2}>
              <InlineInviteBox
                onStartTyping={(email) =>
                  openDrawer("inviteMember", email ? { initialEmail: email } : undefined)
                }
              />
              <PageLayout.HeaderButton onClick={() => openDrawer("inviteMember")}>
                <Plus size={20} />
                Add members
              </PageLayout.HeaderButton>
            </HStack>
          )}
        </HStack>
        {hasOrganizationManagePermission && (
          <MemberSeatUsage organizationId={organization.id} activePlan={activePlan} />
        )}
        <Card.Root width="full" overflow="hidden">
          {/*
            Card wraps the table in overflowX="auto" so the row never
            clips the rightmost ⋮ actions menu on narrow viewports; the
            department picker keeps its full width (do NOT shrink it), and
            the email column truncates with a hover tooltip via
            OverflownTextWithTooltip so long synthetic addresses don't
            push the row width past the viewport.
          */}
          <Card.Body paddingY={0} paddingX={0} overflowX="auto">
            <Table.Root variant="line" size="md" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader width="56px" />
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader maxWidth="280px">Email</Table.ColumnHeader>
                  {hasOrganizationManagePermission && (
                    <Table.ColumnHeader textAlign="right">Access</Table.ColumnHeader>
                  )}
                  {showDepartment && <Table.ColumnHeader>Department</Table.ColumnHeader>}
                  <Table.ColumnHeader width="60px"></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {sortedMembers.map((member) => {
                  return (
                    <Table.Row key={member.userId}>
                      <Table.Cell>
                        <RandomColorAvatar
                          size="2xs"
                          name={member.user.name ?? ""}
                          image={member.user.image}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <HStack>
                          <Button
                            variant="plain"
                            size="sm"
                            padding={0}
                            height="auto"
                            fontWeight="normal"
                            color="colorPalette.fg"
                            colorPalette="blue"
                            onClick={() => {
                              setSelectedMember({
                                userId: member.userId,
                                role: member.role,
                                user: {
                                  name: member.user.name ?? null,
                                  email: member.user.email ?? null,
                                },
                              });
                            }}
                          >
                            {member.user.name}
                          </Button>
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
                        </HStack>
                      </Table.Cell>
                      <Table.Cell maxWidth="280px">
                        <OverflownTextWithTooltip>{member.user.email}</OverflownTextWithTooltip>
                      </Table.Cell>
                      {hasOrganizationManagePermission && (
                        <Table.Cell>
                          <MemberAccessDisplay
                            bindings={bindingsByUser.get(member.userId) ?? []}
                            isLoading={isBindingsLoading || isBindingsError}
                          />
                        </Table.Cell>
                      )}
                      {showDepartment && (
                        <Table.Cell>
                          <DepartmentPicker
                            organizationId={organization.id}
                            kind="user"
                            entityId={member.userId}
                            value={department.byUser.get(member.userId) ?? null}
                            departments={department.departments}
                            onAssigned={department.refetch}
                          />
                        </Table.Cell>
                      )}
                      <Table.Cell>
                        <Box width="full" height="full" display="flex" justifyContent="end">
                          <MemberRowActions
                            member={member}
                            canDisable={canDisableMember(member.userId)}
                            canDelete={canDeleteMember(member.userId)}
                            onEdit={setSelectedMember}
                            onSetDisabled={setMemberDisabled}
                            onDelete={deleteMember}
                          />
                        </Box>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          </Card.Body>
        </Card.Root>

        {hasOrganizationManagePermission && (
          <DomainJoinCard
            key={`${joinRequests.joining.domainJoin}:${joinRequests.joining.joinDomains.join(",")}`}
            domainJoin={joinRequests.joining.domainJoin}
            joinDomains={joinRequests.joining.joinDomains}
            saving={joinRequests.savingJoining}
            onSave={joinRequests.setJoining}
          />
        )}

        <JoinRequestsTable
          requests={joinRequests.requests}
          isAdmin={hasOrganizationManagePermission}
          answeringId={joinRequests.answeringId}
          onApprove={joinRequests.approve}
          onReject={joinRequests.reject}
        />

        <InvitesTable
          invites={invites}
          isAdmin={hasOrganizationManagePermission}
          teams={teams}
          onViewInviteLink={viewInviteLink}
          onResendInvite={resendInvite}
          onRevokeInvite={revokeInvite}
        />
      </VStack>

      {selectedMember && (
        <MemberDetailDialog
          member={selectedMember}
          organizationId={organization.id}
          canManage={hasOrganizationManagePermission}
          isCurrentUser={selectedMember.userId === user?.id}
          open={!!selectedMember}
          onClose={() => setSelectedMember(null)}
        />
      )}

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
                Send the link below to the users you want to invite to join the organization.
              </Text>

              <VStack align="start" gap={4} width="full">
                {selectedInvites.map((invite) => (
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
      {/* The "Add members" flow itself is the URL-routed invite drawer
          (registry key "inviteMember"), rendered by <CurrentDrawer /> — opened
          from the header button, the inline invite box, and the command bar. */}
    </>
  );
}

/**
 * Inline invite box: the moment someone starts typing an email here, hand off
 * to the invite drawer carrying what they typed, so the box is a fast launcher
 * rather than a second, competing invite form.
 */
/**
 * Row actions for a member. Disable is the reversible one, and is how an
 * organization gets back within its licensed seats; delete removes the
 * membership outright. See seat-reconciliation.feature.
 */
function MemberRowActions({
  member,
  canDisable,
  canDelete,
  onEdit,
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
  onEdit: (member: {
    userId: string;
    role: OrganizationUserRole;
    user: { name: string | null; email: string | null };
  }) => void;
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
        <Menu.Item
          value="edit"
          onClick={() =>
            onEdit({
              userId: member.userId,
              role: member.role,
              user: {
                name: member.user.name ?? null,
                email: member.user.email ?? null,
              },
            })
          }
        >
          <Pencil size={16} />
          Edit
        </Menu.Item>
        {canDisable &&
          (member.disabledAt ? (
            <Menu.Item value="enable" onClick={() => onSetDisabled(member.userId, false)}>
              <Undo2 size={16} />
              Enable
            </Menu.Item>
          ) : (
            <Menu.Item value="disable" onClick={() => onSetDisabled(member.userId, true)}>
              <Ban size={16} />
              Disable
            </Menu.Item>
          ))}
        {canDelete && (
          <Menu.Item value="delete" color="red.500" onClick={() => onDelete(member.userId)}>
            <Trash2 size={16} />
            Delete
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

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

function scopeTypeLabel(type: RoleBindingScopeType) {
  if (type === RoleBindingScopeType.ORGANIZATION) return "🏢";
  if (type === RoleBindingScopeType.TEAM) return "👥";
  return "📁";
}

function roleBadgeColor(role: string) {
  if (role === "ADMIN") return "red";
  if (role === "MEMBER") return "blue";
  return "gray";
}

function MemberAccessDisplay({
  bindings,
  isLoading,
}: {
  bindings: Binding[];
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <Text fontSize="xs" color="fg.subtle" textAlign="right">
        -
      </Text>
    );
  }
  if (bindings.length === 0) {
    return (
      <Text fontSize="xs" color="fg.subtle" textAlign="right">
        No access configured
      </Text>
    );
  }
  return (
    <VStack gap={1} align="end">
      {bindings.map((b) => (
        <HStack key={b.id} gap={1} fontSize="xs">
          <Badge colorPalette={roleBadgeColor(b.role)} size="sm">
            {b.customRoleName ?? b.role}
          </Badge>
          <Text color="fg.muted">on</Text>
          <Badge colorPalette="purple" size="sm">
            {scopeTypeLabel(b.scopeType)} {b.scopeName ?? b.scopeId.slice(0, 8) + "…"}
          </Badge>
          {b.groupId && (
            <Text color="fg.subtle" fontSize="xs" title={`via group: ${b.groupName ?? b.groupId}`}>
              via {b.groupName ?? "group"}
            </Text>
          )}
        </HStack>
      ))}
    </VStack>
  );
}
