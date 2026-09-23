/** Top bar: org/product scope (left), account controls (right). Impersonation banner from host. */

import { Box, HStack, Text } from "@chakra-ui/react";
import { Settings as SettingsIcon } from "lucide-react";

import type { NavigationShellReadyState } from "../../behavior/use-navigation-shell-state.ts";
import { APP_HEADER_HEIGHT } from "../../model/menu-widths.ts";
import { useNavigationHost } from "../../model/navigation-host.ts";
import type { ProductId } from "../../model/products.ts";
import { DevBadge } from "../elements/dev-badge.tsx";
import { LogoIcon } from "../elements/logo-icon.tsx";
import { NavigationLink } from "../elements/navigation-link.tsx";
import { AppHeaderUserMenu } from "./app-header-user-menu.tsx";
import { OrganizationSelect } from "./organization-select.tsx";
import { ProductScopeControl } from "./product-scope-control.tsx";
import { ProductSwitcherMenu } from "./product-switcher-menu.tsx";

const LOGO_HEIGHT = 26;

interface ShellTopBarProps {
  state: NavigationShellReadyState;
  /** The icon rail carries the logo and the product tiles instead. */
  shouldShowProductCluster: boolean;
}

/**
 * The navigation-v2 top bar: organization and product-native scope on
 * the left, account controls on the right. In "product-switcher" the
 * logo and dropdown lead; in "icon-rail" the rail carries them instead.
 */
export function ShellTopBar({ state, shouldShowProductCluster }: ShellTopBarProps) {
  const { user, activeProductId, showDevelopmentIndicator } = state;
  const host = useNavigationHost();
  const accountMenu = host.accountMenu();
  // The product cluster spans the sidebar column, so the organization and
  // the scope start at the left edge of the content column and stay there
  // whatever the product label is. A compact sidebar is narrower than the
  // product pill, so there the cluster keeps its own width.
  const clusterWidth = state.isCompactSidebar ? undefined : state.menuWidth;

  return (
    <HStack
      position="relative"
      width="full"
      height={`${APP_HEADER_HEIGHT}px`}
      paddingLeft={shouldShowProductCluster ? 0 : 4}
      paddingRight={4}
      paddingY={3}
      background="bg.page"
      justifyContent="space-between"
      gap={4}
      overflow="hidden"
    >
      {(user?.impersonator || showDevelopmentIndicator) && (
        <Box
          position="absolute"
          top={-5}
          right="-100px"
          bottom={0}
          w="400px"
          background={user?.impersonator ? "blue.300" : "orange.300"}
          filter="blur(40px)"
          pointerEvents="none"
        ></Box>
      )}

      <HStack gap={0} flex={1} alignItems="center" minWidth={0}>
        {shouldShowProductCluster && (
          <ProductCluster activeProductId={activeProductId} width={clusterWidth} />
        )}
        <HStack
          gap={3}
          alignItems="center"
          minWidth={0}
          // The cluster ends at the sidebar edge, so this inset is the
          // gap the organization control keeps from the content column.
          paddingLeft={shouldShowProductCluster ? "22px" : 0}
        >
          <OrganizationSelect activeProductId={activeProductId} />
          <ProductScopeControl activeProductId={activeProductId} />
        </HStack>
      </HStack>

      <HStack gap={2} justifyContent="flex-end" overflow="hidden">
        {showDevelopmentIndicator && <DevBadge />}
        {accountMenu?.headerBanner}
        {host.commandBar()?.trigger}
        <AppHeaderUserMenu />
      </HStack>
    </HStack>
  );
}

function ProductCluster({
  activeProductId,
  width,
}: {
  activeProductId: ProductId | null;
  width: string | undefined;
}) {
  return (
    <HStack
      data-testid="shell-product-cluster"
      width={width}
      minWidth={width}
      flexShrink={0}
      gap={2.5}
      paddingLeft={4}
      alignItems="center"
      overflow="hidden"
    >
      <NavigationLink href="/" display="flex" alignItems="center" flexShrink={0}>
        <LogoIcon width={LOGO_HEIGHT * (38 / 52)} height={LOGO_HEIGHT} />
      </NavigationLink>
      {activeProductId ? (
        <ProductSwitcherMenu activeProductId={activeProductId} />
      ) : (
        // Settings is a detour, not a product to switch between; the way
        // out is the sidebar's back entry. It keeps the switcher pill's
        // inset, so the icon sits where a product icon sits.
        <HStack gap={2} paddingX={2.5} height="28px">
          <SettingsIcon size={14} color="var(--chakra-colors-fg-muted)" />
          <Text fontSize="13px" fontWeight="medium">
            Settings
          </Text>
        </HStack>
      )}
    </HStack>
  );
}
