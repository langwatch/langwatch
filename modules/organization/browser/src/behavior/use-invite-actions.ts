// The seat-quote modal is `@langwatch/workflow-browser`'s singleton store; see
// `use-license-enforcement.ts` for why the address travels and the modal does not.
import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { useUpgradeModalStore } from "@langwatch/browser-host/upgrade-modal-store";
import type { SubmitHandler } from "react-hook-form";

import type { MembersForm } from "../model/member-invite-form.ts";
import { OrganizationUserRole } from "../model/prisma-types.ts";
import { api } from "./organization-api.ts";
import { useOrganizationToaster, useShowErrorToast } from "./organization-feedback.ts";
import { useLicenseEnforcement } from "./use-license-enforcement.ts";

type SeatDecision =
  | { kind: "proceed" }
  | { kind: "expand"; currentSeats: number; newSeats: number }
  | { kind: "upgrade" };

/**
 * A Developer seat sits in neither metered pool, so it trips neither the full-member check nor
 * the lite one.
 */
function isFullSeat(role: OrganizationUserRole): boolean {
  return role === OrganizationUserRole.ADMIN || role === OrganizationUserRole.MEMBER;
}

/**
 * Whether new full members fit the seat limit, and if not, whether the plan expands in place.
 * Limits not loaded yet proceed optimistically; the server is the final guard.
 */
function seatDecision({
  invites,
  limitInfo,
  activePlanSource,
  pricingModel,
}: {
  invites: MembersForm["invites"];
  limitInfo: { current: number; max: number } | undefined | null;
  activePlanSource?: "license" | "subscription" | "free";
  pricingModel?: string;
}): SeatDecision {
  const newFullMembers = invites.filter((invite) => isFullSeat(invite.orgRole)).length;
  if (newFullMembers === 0 || !limitInfo) return { kind: "proceed" };
  const newSeats = limitInfo.current + newFullMembers;
  if (newSeats <= limitInfo.max) return { kind: "proceed" };
  if (activePlanSource === "subscription" && pricingModel === "SEAT_EVENT") {
    return { kind: "expand", currentSeats: limitInfo.max, newSeats };
  }
  return { kind: "upgrade" };
}

/** The invites whose email did not go out, so their links are shown instead. */
function unsentInvites(
  created: readonly (
    | { invite?: { inviteCode: string; email: string }; emailNotSent?: boolean }
    | null
    | undefined
  )[],
): { inviteCode: string; email: string }[] {
  return created.flatMap((entry) =>
    entry?.invite && entry.emailNotSent
      ? [{ inviteCode: entry.invite.inviteCode, email: entry.invite.email }]
      : [],
  );
}

function invitesCreatedToast({
  count,
  hasEmailProvider,
}: {
  count: number;
  hasEmailProvider: boolean;
}) {
  return {
    title: `${count > 1 ? "Invites" : "Invite"} created successfully`,
    description: hasEmailProvider
      ? "All invites have been sent."
      : "All invites have been created. View invite link under actions menu.",
    type: "success",
    duration: 2000,
  };
}

function inviteResentToast({ emailSent }: { emailSent: boolean }) {
  return {
    title: "Invitation resent",
    description: emailSent
      ? "A fresh invitation is on its way."
      : "A fresh invite link is ready to share.",
    type: "success",
    duration: 5000,
  };
}

/** One invite row as the procedure takes it; a team with no custom role sends none. */
function toInviteInput(invite: MembersForm["invites"][number]) {
  return {
    email: invite.email.toLowerCase(),
    role: invite.orgRole,
    teams: invite.teams.map((team) => ({
      teamId: team.teamId,
      role: team.role,
      ...(team.customRoleId ? { customRoleId: team.customRoleId } : {}),
    })),
  };
}

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
  activePlanFree: _activePlanFree,
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
  const analytics = useUiAnalytics();
  const queryClient = api.useUtils();

  /** Invalidate license-limit cache so the next check uses fresh seat counts. */
  const invalidateLimits = () => {
    void queryClient.licenseEnforcement.checkLimit.invalidate();
  };

  const expandSeatsMutation = api.subscription.addTeamMemberOrEvents.useMutation();

  const createInvitesMutation = api.invite.createInvites.useMutation();
  const deleteInviteMutation = api.invite.deleteInvite.useMutation();
  const resendInviteMutation = api.invite.resendInvite.useMutation();

  const performAdminInvite = (data: MembersForm) => {
    createInvitesMutation.mutate(
      {
        organizationId,
        invites: data.invites.map(toInviteInput),
      },
      {
        onSuccess: (data) => {
          onInviteCreated(unsentInvites(data));
          toaster.create(
            invitesCreatedToast({ count: data.filter(Boolean).length, hasEmailProvider }),
          );
          onClose();
          refetchInvites();
          invalidateLimits();
        },
        onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't send the invites" }),
      },
    );
  };

  const onSubmit: SubmitHandler<MembersForm> = (data) => {
    const performMutation = performAdminInvite;
    const proceedAfterLiteCheck = () => {
      if (!data.invites.some((invite) => invite.orgRole === OrganizationUserRole.EXTERNAL)) {
        performMutation(data);
        return;
      }
      membersLiteEnforcement.checkAndProceed(() => performMutation(data));
    };

    const decision = seatDecision({
      invites: data.invites,
      limitInfo: membersEnforcement.limitInfo,
      activePlanSource,
      pricingModel,
    });
    if (decision.kind === "proceed") {
      proceedAfterLiteCheck();
      return;
    }
    if (decision.kind === "upgrade") {
      // Over the limit on a plan that cannot expand in place: this opens the upgrade modal.
      membersEnforcement.checkAndProceed(() => {});
      return;
    }

    const { currentSeats, newSeats } = decision;
    analytics.track({
      boundary: "organization",
      action: "shown",
      name: "upgrade_modal",
      attributes: { mode: "seats", current: currentSeats, max: newSeats },
    });
    openSeats({
      organizationId,
      currentSeats,
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
          showErrorToast({ error: err, fallbackTitle: "Couldn't expand seats" });
        }
      },
    });
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
            onInviteCreated([{ inviteCode: data.invite.inviteCode, email: data.invite.email }]);
          }
          toaster.create(inviteResentToast({ emailSent: hasEmailProvider && !data.emailNotSent }));
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
