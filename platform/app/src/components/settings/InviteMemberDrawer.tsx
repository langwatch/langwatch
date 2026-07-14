import { Heading } from "@chakra-ui/react";
import type React from "react";
import { useDrawer } from "../../hooks/useDrawer";
import { useInviteActions } from "../../hooks/useInviteActions";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { api } from "../../utils/api";
import { AddMembersForm } from "../AddMembersForm";
import { Drawer } from "../ui/drawer";

/**
 * Invite teammates from a URL-routed drawer (see drawers.md) instead of a
 * page-local dialog — so the same flow opens from the members page, the command
 * bar, and the inline invite box, with a stable deep-link and back-button close.
 *
 * The invite mutation, seat/license enforcement and admin-vs-request branching
 * are reused wholesale from `useInviteActions` — the drawer only supplies the
 * organization + team scope and closes itself on success. `initialEmail` seeds
 * the form when the drawer is opened by someone typing into the inline box.
 */
export function InviteMemberDrawer({
  open = true,
  initialEmail = "",
}: {
  open?: boolean;
  initialEmail?: string;
}): React.ReactElement | null {
  const { organization, hasPermission } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();
  const queryClient = api.useContext();
  const publicEnv = usePublicEnv();
  const hasEmailProvider = publicEnv.data?.HAS_EMAIL_PROVIDER_KEY ?? false;

  const activePlan = api.plan.getActivePlan.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization },
  );

  const isAdmin = hasPermission("organization:manage");
  const teamOptions = (organization?.teams ?? []).map((team) => ({
    label: team.name,
    value: team.id,
  }));

  const { onSubmit, isSubmitting } = useInviteActions({
    organizationId: organization?.id ?? "",
    isAdmin,
    hasEmailProvider,
    // Created invite links stay reachable via the invites table's row actions;
    // the drawer's job is to create and close, not to host the link list.
    onInviteCreated: () => {},
    onClose: closeDrawer,
    refetchInvites: () =>
      void queryClient.organization.getOrganizationPendingInvites.invalidate(),
    pricingModel: (organization as { pricingModel?: string } | undefined)
      ?.pricingModel,
    activePlanFree: activePlan.data?.free ?? true,
    activePlanType: activePlan.data?.type ?? "",
    activePlanSource: activePlan.data?.planSource,
  });

  return (
    <Drawer.Root
      open={open}
      placement="end"
      size="lg"
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) closeDrawer();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.Title>
            <Heading size="lg">Add members</Heading>
          </Drawer.Title>
          <Drawer.CloseTrigger onClick={closeDrawer} />
        </Drawer.Header>
        <Drawer.Body>
          {organization && (
            <AddMembersForm
              teamOptions={teamOptions}
              organizationId={organization.id}
              onSubmit={onSubmit}
              isLoading={isSubmitting}
              hasEmailProvider={hasEmailProvider}
              onClose={closeDrawer}
              isInviterAdmin={isAdmin}
              initialEmails={initialEmail}
            />
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
