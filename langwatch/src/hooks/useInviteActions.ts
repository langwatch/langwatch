import { OrganizationUserRole } from "@prisma/client";
import type { SubmitHandler } from "react-hook-form";
import type { MembersForm } from "../components/AddMembersForm";
import { toaster } from "../components/ui/toaster";
import { checkCompoundLimits } from "./useCompoundLicenseCheck";
import { useLicenseEnforcement } from "./useLicenseEnforcement";
import { api } from "../utils/api";

/**
 * Encapsulates invite mutation handlers: create invite (admin), create invite request (non-admin),
 * approve, reject, and delete. Keeps MembersList focused on rendering.
 */
export function useInviteActions({
  organizationId,
  isAdmin,
  hasEmailProvider,
  onInviteCreated,
  onClose,
  refetchInvites,
}: {
  organizationId: string;
  isAdmin: boolean;
  hasEmailProvider: boolean;
  onInviteCreated: (invites: { inviteCode: string; email: string }[]) => void;
  onClose: () => void;
  refetchInvites: () => void;
}) {
  const membersEnforcement = useLicenseEnforcement("members");
  const membersLiteEnforcement = useLicenseEnforcement("membersLite");

  const createInvitesMutation = api.organization.createInvites.useMutation();
  const createInviteRequestMutation =
    api.organization.createInviteRequest.useMutation();
  const approveInviteMutation = api.organization.approveInvite.useMutation();
  const deleteInviteMutation = api.organization.deleteInvite.useMutation();

  const performAdminInvite = (data: MembersForm) => {
    createInvitesMutation.mutate(
      {
        organizationId,
        invites: data.invites.map((invite) => ({
          email: invite.email.toLowerCase(),
          role: invite.orgRole,
          teams: invite.teams.map((team) => ({
            teamId: team.teamId,
            role: team.role,
            customRoleId: team.customRoleId,
          })),
        })),
      },
      {
        onSuccess: (data) => {
          const newInvites = data.reduce(
            (acc, invite) => {
              if (invite?.invite && invite.noEmailProvider) {
                acc.push({
                  inviteCode: invite.invite.inviteCode,
                  email: invite.invite.email,
                });
              }
              return acc;
            },
            [] as { inviteCode: string; email: string }[],
          );

          onInviteCreated(newInvites);

          const description = hasEmailProvider
            ? "All invites have been sent."
            : "All invites have been created. View invite link under actions menu.";

          toaster.create({
            title: `${
              newInvites.length > 1 ? "Invites" : "Invite"
            } created successfully`,
            description,
            type: "success",
            duration: 2000,
            meta: { closable: true },
          });
          onClose();
          refetchInvites();
        },
        onError: () => {
          toaster.create({
            title: "Sorry, something went wrong",
            description: "Please try that again",
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const performInviteRequest = (data: MembersForm) => {
    createInviteRequestMutation.mutate(
      {
        organizationId,
        invites: data.invites.map((invite) => ({
          email: invite.email.toLowerCase(),
          role:
            invite.orgRole === OrganizationUserRole.EXTERNAL
              ? ("EXTERNAL" as const)
              : ("MEMBER" as const),
          teams: invite.teams.map((team) => ({
            teamId: team.teamId,
            role: team.role,
            customRoleId: team.customRoleId,
          })),
        })),
      },
      {
        onSuccess: () => {
          const count = data.invites.length;
          toaster.create({
            title:
              count > 1
                ? "Invitations sent for approval"
                : "Invitation sent for approval",
            description: "An admin will review your invitation request.",
            type: "success",
            duration: 2000,
            meta: { closable: true },
          });
          onClose();
          refetchInvites();
        },
        onError: (error) => {
          toaster.create({
            title: "Sorry, something went wrong",
            description: error.message ?? "Please try that again",
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const onSubmit: SubmitHandler<MembersForm> = (data) => {
    const hasNewFullMembers = data.invites.some(
      (invite) => invite.orgRole !== OrganizationUserRole.EXTERNAL,
    );
    const hasNewLiteMembers = data.invites.some(
      (invite) => invite.orgRole === OrganizationUserRole.EXTERNAL,
    );

    const enforcements = [
      ...(hasNewFullMembers ? [membersEnforcement] : []),
      ...(hasNewLiteMembers ? [membersLiteEnforcement] : []),
    ];

    const performMutation = isAdmin ? performAdminInvite : performInviteRequest;
    checkCompoundLimits(enforcements, () => performMutation(data));
  };

  const approveInvite = (inviteId: string) => {
    approveInviteMutation.mutate(
      { inviteId, organizationId },
      {
        onSuccess: () => {
          toaster.create({
            title: "Invitation approved",
            description: "The invitation has been approved and sent.",
            type: "success",
            duration: 5000,
            meta: { closable: true },
          });
          refetchInvites();
        },
        onError: () => {
          toaster.create({
            title: "Sorry, something went wrong",
            description: "Please try that again",
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const rejectInvite = (inviteId: string) => {
    deleteInviteMutation.mutate(
      { inviteId, organizationId },
      {
        onSuccess: () => {
          toaster.create({
            title: "Invitation rejected",
            description: "The invitation request has been rejected.",
            type: "success",
            duration: 5000,
            meta: { closable: true },
          });
          refetchInvites();
        },
        onError: () => {
          toaster.create({
            title: "Sorry, something went wrong",
            description: "Please try that again",
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const deleteInvite = (inviteId: string) => {
    deleteInviteMutation.mutate(
      { inviteId, organizationId },
      {
        onSuccess: () => {
          toaster.create({
            title: "Invite deleted successfully",
            description: "The invite has been deleted.",
            type: "success",
            duration: 5000,
            meta: { closable: true },
          });
          refetchInvites();
        },
      },
    );
  };

  const isSubmitting =
    createInvitesMutation.isLoading || createInviteRequestMutation.isLoading;

  return {
    onSubmit,
    approveInvite,
    rejectInvite,
    deleteInvite,
    isSubmitting,
  };
}
