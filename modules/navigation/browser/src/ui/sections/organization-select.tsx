/** Organization control (top bar). Uses NavigationOrganization; localStorage through host. */

import { Dialog } from "@langwatch/design-system/dialog";
import { Menu } from "@langwatch/design-system/menu";
import { Button, HStack, Portal, Text } from "@langwatch/design-system/primitives";
import type { NavigationOrganization } from "@langwatch/navigation-contract";
import { CreateTeamDrawerToken } from "@langwatch/organization-client";
import { findLandingProjects } from "@langwatch/project-contract";
import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import { useState } from "react";

import { useProductFlagsByOrganization } from "../../behavior/use-product-flags-by-organization.ts";
import { useNavigationHost } from "../../model/navigation-host.ts";
import {
  isEntityAddressedDetourRoute,
  isSettingsShellRoute,
  type ProductId,
} from "../../model/products.ts";
import { resolveOrgSwitchDestination } from "../../model/resolve-org-switch-destination.ts";

const ORG_NAME_MAX_WIDTH = "280px";
/** Onboarding's welcome screen, told the member wants another organization (its flag). */
const NEW_ORGANIZATION_ADDRESS = "/onboarding/welcome?new_organization=1";
const NO_SHRINK = { flexShrink: 0 };

function firstProjectSlug(organization: NavigationOrganization): string | null {
  for (const team of organization.teams ?? []) {
    if (team.isPersonal) continue;
    // An aggregate is opened on purpose, never landed on (ADR-177 block F).
    const project = findLandingProjects(team.projects ?? [])[0];
    if (project) return project.slug;
  }
  return null;
}

/** Org selector: text (single org), switch (multi-org). Switching clears old project selection. */
export function OrganizationSelect({ activeProductId }: { activeProductId: ProductId | null }) {
  const host = useNavigationHost();
  const organization = host.organization();
  const organizations = host.organizations();

  const [isNewOrganizationOpen, setIsNewOrganizationOpen] = useState(false);

  const organizationIds = organizations.map((org) => org.id);
  const isMultiOrg = organizationIds.length > 1;
  const { reachableProductsIn, isLoading: isReachabilityLoading } = useProductFlagsByOrganization({
    organizationIds,
    enabled: isMultiOrg,
  });

  if (!organization) return null;

  if (!isMultiOrg) {
    // Deliberate: bare muted text where a control could sit reads as a switcher that failed to
    // render. The mark and the weight of a name make it a statement of which organization this is.
    return (
      <HStack
        gap={1.5}
        color="fg.muted"
        whiteSpace="nowrap"
        minWidth={0}
        maxWidth={ORG_NAME_MAX_WIDTH}
      >
        <Building2 size={13} aria-hidden style={NO_SHRINK} />
        <Text textStyle="label" fontWeight="medium" color="fg" truncate title={organization.name}>
          {organization.name}
        </Text>
      </HStack>
    );
  }

  const pathname = host.pathname();
  // A detour page that names an entity of this organization means nothing in
  // the next one, so only an organization-agnostic detour address is kept.
  const keptDetourPathname =
    isSettingsShellRoute(pathname) && !isEntityAddressedDetourRoute(pathname) ? pathname : null;

  const switchToOrganization = (target: NavigationOrganization) => {
    if (target.id === organization.id) return;
    // The remembered team and project both belong to the organization being
    // left; a stale value would resolve a cross-organization scope on the
    // next address that names neither. The landing target repopulates them.
    host.rememberScope({ organizationId: target.id, teamId: "", projectSlug: "" });
    host.navigate(
      resolveOrgSwitchDestination({
        currentProduct: activeProductId,
        reachableProducts: reachableProductsIn(target.id),
        projectSlug: firstProjectSlug(target),
        settingsPathname: keptDetourPathname,
      }),
    );
  };

  return (
    <>
      <OrganizationMenu
        organizations={organizations}
        currentOrganizationId={organization.id}
        currentOrganizationName={organization.name}
        // Which products the next organization can reach decides where the
        // switch lands, so until the gates answer the same click would mean two
        // different pages. The switcher says it is not ready rather than guess.
        isPreparing={isReachabilityLoading}
        onSelect={switchToOrganization}
        onNewOrganization={() => setIsNewOrganizationOpen(true)}
      />
      <NewOrganizationDialog
        open={isNewOrganizationOpen}
        onClose={() => setIsNewOrganizationOpen(false)}
        canCreateTeam={host.hasOrganizationPermission("organization:manage")}
        onCreateTeam={() => {
          setIsNewOrganizationOpen(false);
          host.openDrawerByToken(CreateTeamDrawerToken);
        }}
        onProceed={() => {
          setIsNewOrganizationOpen(false);
          host.navigate(NEW_ORGANIZATION_ADDRESS);
        }}
      />
    </>
  );
}

/** Spec: modules/navigation/specs/product-switcher-navigation.feature (New organization). */
function NewOrganizationDialog({
  open,
  onClose,
  canCreateTeam,
  onCreateTeam,
  onProceed,
}: {
  open: boolean;
  onClose: () => void;
  canCreateTeam: boolean;
  onCreateTeam: () => void;
  onProceed: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New organization"
      size="md"
      primaryAction={{ label: "Proceed with New Organization", onClick: onProceed }}
      secondaryAction={{
        label: "Create New Team",
        onClick: onCreateTeam,
        disabledReason: canCreateTeam ? undefined : "Only organization admins can create teams",
      }}
    >
      <Text textStyle="body">
        A new organization is a completely separate LangWatch account, separate billing, separate
        team members, separate access. If you want to create a different grouping for projects, you
        can create a new team instead.
      </Text>
    </Dialog>
  );
}

function OrganizationMenu({
  organizations,
  currentOrganizationId,
  currentOrganizationName,
  isPreparing,
  onSelect,
  onNewOrganization,
}: {
  organizations: NavigationOrganization[];
  currentOrganizationId: string;
  currentOrganizationName: string;
  isPreparing: boolean;
  onSelect: (organization: NavigationOrganization) => void;
  onNewOrganization: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant="ghost"
          aria-label="Switch organization"
          // Not `loading`: a spinner swapped in for the organization name and
          // straight back out is churn for a wait this short.
          disabled={isPreparing}
          aria-busy={isPreparing || undefined}
          textStyle="bodySm"
          fontWeight="normal"
          paddingX={2}
          height="32px"
          color="fg.muted"
          gap={1.5}
          minWidth={0}
          maxWidth={ORG_NAME_MAX_WIDTH}
          title={currentOrganizationName}
          _hover={{ backgroundColor: "bg.muted" }}
        >
          <Text truncate>{currentOrganizationName}</Text>
          <ChevronsUpDown size={12} style={NO_SHRINK} />
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Content minWidth="220px" maxWidth="min(360px, 90vw)">
          <Menu.ItemGroup title="Organizations">
            {organizations.map((org) => (
              <Menu.Item
                key={org.id}
                value={org.id}
                onClick={() => onSelect(org)}
                textStyle="bodySm"
              >
                <Text flex={1} minWidth={0} truncate title={org.name}>
                  {org.name}
                </Text>
                {org.id === currentOrganizationId && (
                  <Check size={13} aria-label="Current organization" style={NO_SHRINK} />
                )}
              </Menu.Item>
            ))}
          </Menu.ItemGroup>
          <Menu.Separator />
          <Menu.Item value="new-organization" onClick={onNewOrganization} textStyle="bodySm">
            <Plus size={13} aria-hidden style={NO_SHRINK} />
            New organization
          </Menu.Item>
        </Menu.Content>
      </Portal>
    </Menu.Root>
  );
}
