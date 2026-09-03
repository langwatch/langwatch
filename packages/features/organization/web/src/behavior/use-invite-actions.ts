import type { SubmitHandler } from "react-hook-form";
import { OrganizationUserRole } from "../model/prisma-types";
import type { MembersForm } from "../model/member-invite-form";
// The seat-quote modal is `@langwatch/workflow-web`'s singleton store; see
// `use-license-enforcement.ts` for why the address travels and the modal does not.
import { useUpgradeModalStore } from "@langwatch/ui-host/upgrade-modal-store";
import { api } from "../behavior/organization-api";
import { useLicenseEnforcement } from "./use-license-enforcement";
import { useOrganizationToaster, useShowErrorToast } from "../behavior/organization-feedback";

/**
 * Invite mutation handlers: create, resend, revoke. All pricing models go
 * through enforcement first — SEAT_EVENT with an active subscription opens
 * the proration preview, otherwise the standard upgrade modal.
 */
export function useInviteActions({
  organizationId,
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
  const toaster = useOrganizationToaster();
  const showErrorToast = useShowErrorToast();
  const membersEnforcement = useLicenseEnforcement("members");
  const membersLiteEnforcement = useLicenseEnforcement("membersLite");
  const openSeats = useUpgradeModalStore((s) => s.openSeats);
  const queryClient = api.useUtils();

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
  const deleteInviteMutation = api.organization.deleteInvite.useMutation();
  const resendInviteMutation = api.organization.resendInvite.useMutation();

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
            customRoleId: team.customRoleId ?? null,
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
            title: `${totalInvites > 1 ? "Invites" : "Invite"} created successfully`,
            description,
            type: "success",
            duration: 2000,
          });
          onClose();
          refetchInvites();
          invalidateLimits();
        },
        onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't send the invites" }),
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

    const performMutation = performAdminInvite;

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
            showErrorToast({
              error: err,
              fallbackTitle: "Couldn't expand seats",
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

  const revokeInvite = (inviteId: string) => {
    deleteInviteMutation.mutate(
      { inviteId, organizationId },
      {
        onSuccess: () => {
          toaster.create({
            title: "Invitation revoked",
            description: "The invitation link no longer works.",
            type: "success",
            duration: 5000,
          });
          refetchInvites();
          invalidateLimits();
        },
        onError: (error) =>
          showErrorToast({
            error,
            fallbackTitle: "Couldn't revoke the invitation",
          }),
      },
    );
  };

  /**
   * One-click resend (D11): a fresh code, a fresh expiry, a fresh email.
   * Without an email provider the fresh link is surfaced instead, the same
   * way invite creation surfaces it.
   */
  const resendInvite = (inviteId: string) => {
    resendInviteMutation.mutate(
      { inviteId, organizationId },
      {
        onSuccess: (data) => {
          if (data.emailNotSent) {
            onInviteCreated([
              {
                inviteCode: data.invite.inviteCode,
                email: data.invite.email,
              },
            ]);
          }
          toaster.create({
            title: "Invitation resent",
            description:
              hasEmailProvider && !data.emailNotSent
                ? "A fresh invitation is on its way."
                : "A fresh invite link is ready to share.",
            type: "success",
            duration: 5000,
          });
          refetchInvites();
        },
        onError: (error) =>
          showErrorToast({
            error,
            fallbackTitle: "Couldn't resend the invitation",
          }),
      },
    );
  };

  const isSubmitting = createInvitesMutation.isPending;

  return {
    onSubmit,
    revokeInvite,
    resendInvite,
    isSubmitting,
  };
}
