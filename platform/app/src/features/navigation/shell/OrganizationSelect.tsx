import { Button, HStack, Portal, Text } from "@chakra-ui/react";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { useLocalStorage } from "usehooks-ts";
import { Menu } from "~/components/ui/menu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { FullyLoadedOrganization } from "~/server/app-layer/organizations/repositories/organization.repository";
import { useRouter } from "~/utils/compat/next-router";
import { resolveOrgSwitchDestination } from "../logic/resolveOrgSwitchDestination";
import type { ProductId } from "../products";
import { useProductFlagsByOrganization } from "./useProductFlagsByOrganization";

function firstProjectSlug(
  organization: FullyLoadedOrganization,
): string | null {
  for (const team of organization.teams ?? []) {
    if (team.isPersonal) continue;
    const project = team.projects?.[0];
    if (project) return project.slug;
  }
  return null;
}

/**
 * The organization in the product-switcher top bar: plain text for a
 * single-organization user, an in-place switch for a multi-organization
 * user. Switching stores the organization the resolver reads, clears the
 * stored project selection (it belongs to the old organization), and
 * lands on the same product's home in the new organization when it is
 * reachable there.
 *
 * Spec: specs/navigation/product-switcher-navigation.feature
 */
export function OrganizationSelect({
  activeProductId,
}: {
  activeProductId: ProductId | null;
}) {
  const router = useRouter();
  const { organization, organizations } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const [, setSelectedOrganizationId] = useLocalStorage<string>(
    "selectedOrganizationId",
    "",
  );

  const organizationIds = (organizations ?? []).map((org) => org.id);
  const isMultiOrg = organizationIds.length > 1;
  const { reachableProductsIn, isLoading: isReachabilityLoading } =
    useProductFlagsByOrganization({
      organizationIds,
      enabled: isMultiOrg,
    });

  if (!organization) return null;

  if (!isMultiOrg) {
    // DELIBERATE, NOT LEFT OVER. Bare muted text in the slot where a control
    // would be reads as a switcher that failed to render — the same size, the
    // same colour, the chevron simply missing. A mark before it and the weight
    // of a name make it the thing it is: a statement of which organization you
    // are in, for somebody who is only ever in one.
    return (
      <HStack gap={1.5} color="fg.muted" whiteSpace="nowrap">
        <Building2 size={13} aria-hidden />
        <Text fontSize="13px" fontWeight="medium" color="fg">
          {organization.name}
        </Text>
      </HStack>
    );
  }

  const switchToOrganization = (target: FullyLoadedOrganization) => {
    if (target.id === organization.id) return;
    setSelectedOrganizationId(target.id);
    // The stored project belongs to the old organization; a stale value
    // would resolve a cross-organization project on the next slug-less
    // page. The landing target repopulates it.
    window.localStorage.removeItem("selectedProjectSlug");
    // Before the target organization's product gates answer, every
    // optional product reads as unreachable, which would land the user
    // on a fallback. The root re-resolves once they answer.
    void router.push(
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
      organizations={organizations ?? []}
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
  organizations: FullyLoadedOrganization[];
  currentOrganizationId: string;
  currentOrganizationName: string;
  onSelect: (organization: FullyLoadedOrganization) => void;
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
          _hover={{ backgroundColor: "bg.muted" }}
        >
          <Text>{currentOrganizationName}</Text>
          <ChevronsUpDown size={12} />
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Content minWidth="220px">
          <Menu.ItemGroup title="Organizations">
            {organizations.map((org) => (
              <Menu.Item
                key={org.id}
                value={org.id}
                onClick={() => onSelect(org)}
                fontSize="13px"
              >
                <Text flex={1}>{org.name}</Text>
                {org.id === currentOrganizationId && (
                  <Check size={13} aria-label="Current organization" />
                )}
              </Menu.Item>
            ))}
          </Menu.ItemGroup>
        </Menu.Content>
      </Portal>
    </Menu.Root>
  );
}
