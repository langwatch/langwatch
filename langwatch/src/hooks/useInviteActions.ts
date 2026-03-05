import { OrganizationUserRole } from "@prisma/client";
import type { SubmitHandler } from "react-hook-form";
import type { MembersForm } from "../components/AddMembersForm";
import { toaster } from "../components/ui/toaster";
import { useUpgradeModalStore } from "../stores/upgradeModalStore";
import { useLicenseEnforcement } from "./useLicenseEnforcement";
import { api } from "../utils/api";

/**
 * Encapsulates invite mutation handlers: create invite (admin), create invite request (non-admin),
 * approve, reject, and delete. Keeps MembersList focused on rendering.
 *
 * All pricing models go through enforcement first. When `pricingModel` is "SEAT_EVENT"
 * and the user has an active subscription, exceeding the limit opens the proration
 * preview modal. Otherwise, the standard upgrade modal is shown.
 */
export function useInviteActions({
  organizationId,
  isAdmin,
  hasEmailProvider,
  onInviteCreated,
  onClose,
  refetchInvites,
  pricingModel,
  activePlanFree,
  activePlanType,
  activePlanSource,
}: {
  organizationId: string;
  isAdmin: boolean;
  hasEmailProvider: boolean;
  onInviteCreated: (invites: { inviteCode: string; email: string }[]) => void;
  onClose: () => void;
  refetchInvites: () => void;
  /** Pricing model of the organization (e.g. "SEAT_EVENT", "TIERED"). */
  pricingModel?: string;
  /** Whether the active plan is a free plan (no paid subscription). */
  activePlanFree: boolean;
  /** The active plan type string (e.g. "GROWTH_SEAT_EUR_MONTHLY"). */
  activePlanType: string;
  /** Where the active plan came from ("license", "subscription", or "free"). */
  activePlanSource?: "license" | "subscription" | "free";
}) {
  const membersEnforcement = useLicenseEnforcement("members");
  const membersLiteEnforcement = useLicenseEnforcement("membersLite");
  const openSeats = useUpgradeModalStore((s) => s.openSeats);
  const queryClient = api.useContext();

  /** Invalidate license-limit cache so the next check uses fresh seat counts. */
  const invalidateLimits = () => {
    void queryClient.licenseEnforcement.checkLimit.invalidate();
  };

  // SaaS-only: subscription API for seat expansion (not available in OSS builds).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subscriptionApi = (api as any).subscription;
  // Build-time invariant: subscriptionApi shape is fixed per build (SaaS vs OSS)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, react-hooks/rules-of-hooks
  const expandSeatsMutation = subscriptionApi?.addTeamMemberOrEvents?.useMutation() as
    | { mutateAsync: (input: Record<string, unknown>) => Promise<unknown> }
    | undefined;

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
              if (invite?.invite && invite.emailNotSent) {
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

          const totalInvites = data.filter(Boolean).length;
          const description = hasEmailProvider
            ? "All invites have been sent."
            : "All invites have been created. View invite link under actions menu.";

          toaster.create({
            title: `${
              totalInvites > 1 ? "Invites" : "Invite"
            } created successfully`,
            description,
            type: "success",
            duration: 2000,
            meta: { closable: true },
          });
          onClose();
          refetchInvites();
          invalidateLimits();
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
          invalidateLimits();
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
    const newFullMemberInviteCount = data.invites.filter(
      (invite) => invite.orgRole !== OrganizationUserRole.EXTERNAL,
    ).length;

    const performMutation = isAdmin ? performAdminInvite : performInviteRequest;

    // Check lite member limits, then perform the mutation
    const proceedAfterLiteCheck = () => {
      if (hasNewLiteMembers) {
        membersLiteEnforcement.checkAndProceed(() => performMutation(data));
      } else {
        performMutation(data);
      }
    };

    // No full members being invited — only check lite limits
    if (!hasNewFullMembers) {
      proceedAfterLiteCheck();
      return;
    }

    const limitInfo = membersEnforcement.limitInfo;
    // Data not loaded yet — allow optimistically (server is final guard)
    if (!limitInfo) {
      proceedAfterLiteCheck();
      return;
    }

    const projectedCount = limitInfo.current + newFullMemberInviteCount;

    if (projectedCount <= limitInfo.max) {
      // Within limits — proceed directly
      proceedAfterLiteCheck();
      return;
    }

    // Over limit — decide which modal to show
    if (
      activePlanSource === "subscription" &&
      pricingModel === "SEAT_EVENT" &&
      expandSeatsMutation
    ) {
      // SEAT_EVENT with active subscription — proration modal
      const newSeats = limitInfo.current + newFullMemberInviteCount;
      openSeats({
        organizationId,
        currentSeats: limitInfo.max,
        newSeats,
        onConfirm: async () => {
          try {
            await expandSeatsMutation.mutateAsync({
              organizationId,
              plan: activePlanType,
              upgradeMembers: true,
              upgradeTraces: false,
              totalMembers: newSeats,
              totalTraces: 0,
            });
            performMutation(data);
          } catch (err) {
            toaster.create({
              title: "Failed to expand seats",
              description: err instanceof Error ? err.message : "Please try again",
              type: "error",
              duration: 5000,
              meta: { closable: true },
            });
          }
        },
      });
    } else {
      // TIERED, free plan, self-hosted, no subscription — upgrade modal
      membersEnforcement.checkAndProceed(() => {
        // Won't execute since we know it's over limit,
        // but checkAndProceed will open the upgrade modal
      });
    }
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
          invalidateLimits();
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
          invalidateLimits();
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
          invalidateLimits();
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
