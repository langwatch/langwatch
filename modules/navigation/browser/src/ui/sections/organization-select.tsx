/** Organization control (top bar). Uses NavigationOrganization; localStorage through host. */

import { Menu } from "@langwatch/design-system/menu";
import { Button, HStack, Portal, Text } from "@langwatch/design-system/primitives";
import type { NavigationOrganization } from "@langwatch/navigation-contract";
import { findLandingProjects } from "@langwatch/project-contract";
import { Building2, Check, ChevronsUpDown } from "lucide-react";

import { useProductFlagsByOrganization } from "../../behavior/use-product-flags-by-organization.ts";
import { useNavigationHost } from "../../model/navigation-host.ts";
import type { ProductId } from "../../model/products.ts";
import { resolveOrgSwitchDestination } from "../../model/resolve-org-switch-destination.ts";

const ORG_NAME_MAX_WIDTH = "280px";
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
        <Text fontSize="13px" fontWeight="medium" color="fg" truncate title={organization.name}>
          {organization.name}
        </Text>
      </HStack>
    );
  }

  const switchToOrganization = (target: NavigationOrganization) => {
    if (target.id === organization.id) return;
    // The remembered project belongs to the organization being left; a stale
    // value would resolve a cross-organization project on the next slug-less
    // address. The landing target repopulates it.
    host.rememberScope({ organizationId: target.id, projectSlug: "" });
    // Before the target organization's product gates answer, every optional
    // product reads as unreachable, which would land the reader on a
    // fallback. The root re-resolves once they answer.
    host.navigate(
      isReachabilityLoading
        ? "/"
        : resolveOrgSwitchDestination({
            currentProduct: activeProductId,
            reachableProducts: reachableProductsIn(target.id),
            projectSlug: firstProjectSlug(target),
          }),
    );
  };

  return (
    <OrganizationMenu
      organizations={organizations}
      currentOrganizationId={organization.id}
      currentOrganizationName={organization.name}
      onSelect={switchToOrganization}
    />
  );
}

function OrganizationMenu({
  organizations,
  currentOrganizationId,
  currentOrganizationName,
  onSelect,
}: {
  organizations: NavigationOrganization[];
  currentOrganizationId: string;
  currentOrganizationName: string;
  onSelect: (organization: NavigationOrganization) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant="ghost"
          aria-label="Switch organization"
          fontSize="13px"
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
              <Menu.Item key={org.id} value={org.id} onClick={() => onSelect(org)} fontSize="13px">
                <Text flex={1} minWidth={0} truncate title={org.name}>
                  {org.name}
                </Text>
                {org.id === currentOrganizationId && (
                  <Check size={13} aria-label="Current organization" style={NO_SHRINK} />
                )}
              </Menu.Item>
            ))}
          </Menu.ItemGroup>
        </Menu.Content>
      </Portal>
    </Menu.Root>
  );
}
