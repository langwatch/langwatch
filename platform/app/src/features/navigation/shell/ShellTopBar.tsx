import { Box, HStack, Text } from "@chakra-ui/react";
import { Settings as SettingsIcon } from "lucide-react";
import { AppHeaderUserMenu } from "~/components/AppHeaderUserMenu";
import { LogoIcon } from "~/components/icons/LogoIcon";
import { Link } from "~/components/ui/link";
import { CommandBarTrigger } from "~/features/command-bar";
import { APP_HEADER_HEIGHT } from "~/features/langy/logic/langyPanelLayout";
import { ImpersonationBanner } from "../../../../ee/admin/ImpersonationBanner";
import type { ProductId } from "../products";
import { OrganizationSelect } from "./OrganizationSelect";
import { ProductScopeControl } from "./ProductScopeControl";
import { ProductSwitcherMenu } from "./ProductSwitcherMenu";
import type { NavigationV2ShellReadyState } from "./useNavigationV2ShellState";

interface ShellTopBarProps {
  state: NavigationV2ShellReadyState;
  /** The icon rail carries the logo and the product tiles instead. */
  showProductCluster: boolean;
}

/**
 * The navigation-v2 top bar: the organization and the product-native
 * scope on the left, the account controls on the right. In
 * "product-switcher" the logo and the product dropdown lead the left
 * side; in "icon-rail" the rail carries them and they are hidden here.
 */
export function ShellTopBar({ state, showProductCluster }: ShellTopBarProps) {
  const { user, project, activeProductId, isDevelopment } = state;

  return (
    <HStack
      position="relative"
      width="full"
      height={`${APP_HEADER_HEIGHT}px`}
      paddingX={4}
      paddingY={3}
      background="bg.page"
      justifyContent="space-between"
      gap={4}
      overflow="hidden"
    >
      {(user?.impersonator || isDevelopment) && (
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

      <HStack gap={3} flex={1} alignItems="center" minWidth={0}>
        {showProductCluster && (
          <ProductCluster activeProductId={activeProductId} />
        )}
        <OrganizationSelect activeProductId={activeProductId} />
        <ProductScopeControl activeProductId={activeProductId} />
      </HStack>

      <HStack gap={2} justifyContent="flex-end" overflow="hidden">
        {isDevelopment && <DevBadge />}
        {user && <ImpersonationBanner user={user} />}
        {project && <CommandBarTrigger />}
        <AppHeaderUserMenu showPresenceMenuItem={state.showPresenceMenuItem} />
      </HStack>
    </HStack>
  );
}

function ProductCluster({
  activeProductId,
}: {
  activeProductId: ProductId | null;
}) {
  return (
    <>
      <Link href="/" display="flex" alignItems="center">
        <LogoIcon width={25 * 0.7} height={32 * 0.7} />
      </Link>
      {activeProductId ? (
        <ProductSwitcherMenu activeProductId={activeProductId} />
      ) : (
        // Settings is a detour, not a product to switch between; the way
        // out is the sidebar's back entry.
        <HStack gap={2} paddingX={2}>
          <SettingsIcon size={14} color="var(--chakra-colors-fg-muted)" />
          <Text fontSize="13px" fontWeight="medium">
            Settings
          </Text>
        </HStack>
      )}
    </>
  );
}

function DevBadge() {
  return (
    <Text
      fontSize="11px"
      fontWeight="bold"
      color="white"
      backgroundColor="blackAlpha.600"
      border="1px solid"
      borderColor="whiteAlpha.300"
      borderRadius="full"
      height="32px"
      paddingX={3}
      display="flex"
      alignItems="center"
      letterSpacing="wider"
    >
      DEV
    </Text>
  );
}
