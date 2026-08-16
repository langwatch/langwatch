import { Button, Portal, Text } from "@chakra-ui/react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useLocalStorage } from "usehooks-ts";
import { Menu } from "~/components/ui/menu";
import { CLIENT_FLAG_STALE_TIME_MS } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { FullyLoadedOrganization } from "~/server/app-layer/organizations/repositories/organization.repository";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { resolveOrgSwitchDestination } from "../logic/resolveOrgSwitchDestination";
import type { ProductId } from "../products";

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
  // The switch destination needs the TARGET organization's product
  // reachability; these are the only per-organization gates resolvable
  // from here (permissions stay page-enforced).
  const flagQueryOptions = {
    enabled: isMultiOrg,
    staleTime: CLIENT_FLAG_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  };
  const governanceByOrg = api.featureFlag.isEnabledForEachOrganization.useQuery(
    { flag: "release_ui_ai_governance_enabled", organizationIds },
    flagQueryOptions,
  );
  const gatewayByOrg = api.featureFlag.isEnabledForEachOrganization.useQuery(
    { flag: "release_ui_ai_gateway_menu_enabled", organizationIds },
    flagQueryOptions,
  );

  if (!organization) return null;

  if (!isMultiOrg) {
    return (
      <Text fontSize="13px" color="fg.muted" whiteSpace="nowrap">
        {organization.name}
      </Text>
    );
  }

  const switchToOrganization = (target: FullyLoadedOrganization) => {
    if (target.id === organization.id) return;
    setSelectedOrganizationId(target.id);
    // The stored project belongs to the old organization; a stale value
    // would resolve a cross-organization project on the next slug-less
    // page. The landing target repopulates it.
    window.localStorage.removeItem("selectedProjectSlug");
    const reachableProducts: ProductId[] = ["llm-ops"];
    if (governanceByOrg.data?.enabledByOrganizationId?.[target.id]) {
      reachableProducts.push("me", "governance");
    }
    if (gatewayByOrg.data?.enabledByOrganizationId?.[target.id]) {
      reachableProducts.push("gateway");
    }
    void router.push(
      resolveOrgSwitchDestination({
        currentProduct: activeProductId,
        reachableProducts,
        projectSlug: firstProjectSlug(target),
      }),
    );
  };

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
          <Text>{organization.name}</Text>
          <ChevronsUpDown size={12} />
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Content minWidth="220px">
          <Menu.ItemGroup title="Organizations">
            {(organizations ?? []).map((org) => (
              <Menu.Item
                key={org.id}
                value={org.id}
                onClick={() => switchToOrganization(org)}
                fontSize="13px"
              >
                <Text flex={1}>{org.name}</Text>
                {org.id === organization.id && (
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
