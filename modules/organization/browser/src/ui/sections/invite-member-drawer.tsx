// biome-ignore lint/suspicious/noEmptyBlockStatements: empty blocks are deliberate.

import { Drawer } from "@langwatch/design-system/drawer";
import type { UiInviteMemberDrawerProps } from "@langwatch/organization-contract";
import type React from "react";
import { useRef } from "react";

import { api } from "../../behavior/organization-api.ts";
import { useDrawer } from "../../behavior/use-drawer.ts";
import { useInviteActions } from "../../behavior/use-invite-actions.ts";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project.ts";
import { usePublicEnv } from "../../behavior/use-public-env.ts";
import { useOrganizationHost } from "../../model/organization-host.ts";
import { AddMembersForm } from "./add-members-form.tsx";

const INVITE_FORM_ID = "invite-members-form";

/** Invite drawer: stable deep-link from members page, command bar, or inline box. */
export function InviteMemberDrawer({
  open = true,
  initialEmail = "",
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
          "data-testid": "members-invite-submit",
        },
      }}
    >
      {organization && (
        <AddMembersForm
          teamOptions={teamOptions}
          organizationId={organization.id}
          onSubmit={onSubmit}
          isLoading={isSubmitting}
          formId={INVITE_FORM_ID}
          hasEmailProvider={hasEmailProvider}
          onClose={closeDrawer}
          isInviterAdmin={isAdmin}
          initialEmails={initialEmail}
        />
      )}
    </Drawer>
  );
}
