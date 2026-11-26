// biome-ignore lint/suspicious/noEmptyBlockStatements: empty blocks are deliberate.

import { Drawer } from "@langwatch/design-system/drawer";
import type { UiInviteMemberDrawerProps } from "@langwatch/organization-contract";
import type React from "react";
import { useRef, useState } from "react";

import { api } from "../../behavior/organization-api.ts";
import { useDrawer } from "../../behavior/use-drawer.ts";
import { useGrowthSeatPrice } from "../../behavior/use-growth-seat-price.ts";
import { useInviteActions } from "../../behavior/use-invite-actions.ts";
import { useLicenseEnforcement } from "../../behavior/use-license-enforcement.ts";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project.ts";
import { usePublicEnv } from "../../behavior/use-public-env.ts";
import { BILLING_ONLY_SEAT, type InviteSeat } from "../../model/member-invite-form.ts";
import { useOrganizationHost } from "../../model/organization-host.ts";
import { OrganizationUserRole } from "../../model/prisma-types.ts";
import { AddMembersForm } from "./add-members-form.tsx";

const INVITE_FORM_ID = "invite-members-form";

/** Invite drawer: stable deep-link from members page, command bar, or inline box. */
export function InviteMemberDrawer({
  open = true,
  initialEmail = "",
  initialSeat,
}: UiInviteMemberDrawerProps): React.ReactElement | null {
  const { organization } = useOrganizationTeamProject();
  const host = useOrganizationHost();
  const { closeDrawer } = useDrawer();
  const contentRef = useRef<HTMLDivElement>(null);
  const queryClient = api.useUtils();
  const publicEnv = usePublicEnv();
  const hasEmailProvider = publicEnv.data?.HAS_EMAIL_PROVIDER_KEY ?? false;

  const activePlan = api.plan.getActivePlan.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization },
  );

  const isAdmin = host.hasPermission("organization:manage");
  const members = useLicenseEnforcement("members").limitInfo;
  const growthSeatPrice = useGrowthSeatPrice({
    currency: (organization as { currency?: "USD" | "EUR" } | undefined)?.currency ?? "USD",
  });
  const [seat, setSeat] = useState<InviteSeat | undefined>(undefined);
  // Free sells no Lite seat, so the admin is offered Billing only for whoever pays.
  const freePlan =
    isAdmin &&
    organization &&
    activePlan.data?.free === true &&
    activePlan.data.maxMembersLite === 0
      ? {
          organizationName: organization.name,
          ...(members ? { membersUsed: members.current, membersMax: members.max } : {}),
          ...(growthSeatPrice ? { growthSeatPrice } : {}),
          onUpgrade: () => {
            closeDrawer();
            host.navigate("/settings/subscription");
          },
        }
      : undefined;
  const liteRefused = freePlan !== undefined && seat === OrganizationUserRole.EXTERNAL;
  const teamOptions = (organization?.teams ?? []).map((team) => ({
    label: team.name,
    value: team.id,
  }));

  const { onSubmit, isSubmitting } = useInviteActions({
    organizationId: organization?.id ?? "",
    hasEmailProvider,
    // Created invite links stay reachable via the invites table's row actions;
    // the drawer's job is to create and close, not to host the link list.
    onInviteCreated: () => {},
    onClose: closeDrawer,
    refetchInvites: () => {
      void queryClient.invite.getOrganizationPendingInvites.invalidate();
      void queryClient.organization.getDirectoryCounts.invalidate();
    },
    pricingModel: (organization as { pricingModel?: string } | undefined)?.pricingModel,
    activePlanFree: activePlan.data?.free ?? true,
    activePlanType: activePlan.data?.type ?? "",
    activePlanSource: activePlan.data?.planSource,
  });

  return (
    <Drawer
      open={open}
      onClose={closeDrawer}
      title="Add members"
      size="lg"
      contentRef={contentRef}
      // Else the dialog focuses its Close button and typing from the inline box is lost.
      initialFocusEl={() => contentRef.current?.querySelector("input") ?? null}
      footer={{
        cancel: { onClick: closeDrawer },
        busy: isSubmitting,
        primaryAction: {
          label: hasEmailProvider ? "Send invites" : "Create invites",
          type: "submit",
          form: INVITE_FORM_ID,
          loading: isSubmitting,
          ...(liteRefused ? { disabledReason: "Free has no Lite seats" } : {}),
          "data-testid": "members-invite-submit",
        },
      }}
    >
      {organization && (
        <AddMembersForm
          // The limit dialog can reopen this drawer on Billing only while it is already open.
          key={initialSeat ?? "default"}
          teamOptions={teamOptions}
          organizationId={organization.id}
          onSubmit={onSubmit}
          isLoading={isSubmitting}
          formId={INVITE_FORM_ID}
          hasEmailProvider={hasEmailProvider}
          onClose={closeDrawer}
          isInviterAdmin={isAdmin}
          initialEmails={initialEmail}
          onSeatChange={setSeat}
          {...(freePlan ? { freePlan } : {})}
          {...(initialSeat === BILLING_ONLY_SEAT ? { initialSeat: BILLING_ONLY_SEAT } : {})}
        />
      )}
    </Drawer>
  );
}
