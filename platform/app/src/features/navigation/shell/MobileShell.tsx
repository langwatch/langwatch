import { Box, HStack, IconButton, Spacer, Text } from "@chakra-ui/react";
import { Menu as MenuIcon, Settings as SettingsIcon, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { AppHeaderUserMenu } from "~/components/AppHeaderUserMenu";
import { LogoIcon } from "~/components/icons/LogoIcon";
import { SideMenuDensityProvider } from "~/components/sidebar/sideMenuDensity";
import { Link } from "~/components/ui/link";
import { APP_HEADER_HEIGHT } from "~/features/langy/logic/langyPanelLayout";
import { usePathname } from "~/utils/compat/next-navigation";
import type { ProductId } from "../products";
import { OrganizationSelect } from "./OrganizationSelect";
import { ProductScopeControl } from "./ProductScopeControl";
import { SidebarContent } from "./ProductSidebar";
import { ProductSwitcherMenu } from "./ProductSwitcherMenu";
import type { NavigationV2ShellReadyState } from "./useNavigationV2ShellState";

const LOGO_HEIGHT = 24;

/**
 * The navigation-v2 chrome on a phone-width viewport: one compact bar
 * with the logo, the product selector, the product's own scope control
 * and a menu button; the page below it takes the rest of the screen.
 * The menu button opens a full-screen overlay carrying the organization
 * and project selectors, the product's pages and the account controls.
 *
 * Spec: specs/navigation/mobile-chrome.feature
 */
export function MobileShell({
  state,
  children,
}: {
  state: NavigationV2ShellReadyState;
  children: ReactNode;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const pathname = usePathname();

  // A tap on any menu entry navigates, and the new page is the reason
  // the menu was opened, so the overlay stands down on its own.
  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  return (
    <>
      <MobileTopBar
        activeProductId={state.activeProductId}
        isMenuOpen={false}
        onMenuToggle={() => setIsMenuOpen(true)}
      />
      <Box
        width="full"
        background="bg.surface"
        borderTopWidth="1px"
        borderColor="border"
        minHeight={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
        maxHeight={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
        overflow="auto"
        display="flex"
        position="relative"
      >
        {children}
      </Box>
      {isMenuOpen && (
        <MobileMenuOverlay state={state} onClose={() => setIsMenuOpen(false)} />
      )}
    </>
  );
}

/**
 * The compact bar: logo, product, the product's own scope, and the menu
 * button. LLM Ops keeps the organization out of the bar so the project
 * chip has the room; the organization-wide products carry the
 * organization control instead. The same bar heads the overlay, where
 * the button becomes the way to close it.
 */
function MobileTopBar({
  activeProductId,
  isMenuOpen,
  onMenuToggle,
}: {
  activeProductId: ProductId | null;
  isMenuOpen: boolean;
  onMenuToggle: () => void;
}) {
  const showsOwnScope =
    activeProductId === "llm-ops" || activeProductId === "me";

  return (
    <HStack
      width="full"
      height={`${APP_HEADER_HEIGHT}px`}
      paddingX={3}
      gap={1}
      background="bg.page"
      justifyContent="space-between"
      overflow="hidden"
    >
      <HStack gap={2} minWidth={0} flex={1} alignItems="center">
        <Link href="/" display="flex" alignItems="center" flexShrink={0}>
          <LogoIcon width={LOGO_HEIGHT * (38 / 52)} height={LOGO_HEIGHT} />
        </Link>
        {activeProductId ? (
          <ProductSwitcherMenu activeProductId={activeProductId} />
        ) : (
          <HStack gap={2} paddingX={1} flexShrink={0}>
            <SettingsIcon size={14} color="var(--chakra-colors-fg-muted)" />
            <Text fontSize="13px" fontWeight="medium">
              Settings
            </Text>
          </HStack>
        )}
        {showsOwnScope ? (
          <ProductScopeControl activeProductId={activeProductId} />
        ) : (
          <OrganizationSelect activeProductId={activeProductId} />
        )}
      </HStack>
      <IconButton
        aria-label={
          isMenuOpen ? "Close navigation menu" : "Open navigation menu"
        }
        variant="ghost"
        size="sm"
        onClick={onMenuToggle}
      >
        {isMenuOpen ? <X size={20} /> : <MenuIcon size={20} />}
      </IconButton>
    </HStack>
  );
}

/**
 * The full-screen menu: the same bar on top with the close button, the
 * organization and the product scope side by side under it (so a
 * multi-organization user can switch both from here), then the
 * product's pages and the pinned bottom block the desktop sidebar
 * carries.
 */
function MobileMenuOverlay({
  state,
  onClose,
}: {
  state: NavigationV2ShellReadyState;
  onClose: () => void;
}) {
  return (
    <Box
      data-testid="mobile-menu-overlay"
      position="fixed"
      inset={0}
      zIndex={1300}
      background="bg.page"
      display="flex"
      flexDirection="column"
    >
      <MobileTopBar
        activeProductId={state.activeProductId}
        isMenuOpen
        onMenuToggle={onClose}
      />
      <HStack
        paddingX={4}
        paddingY={2}
        gap={2}
        borderBottomWidth="1px"
        borderColor="border"
      >
        <OrganizationSelect activeProductId={state.activeProductId} />
        <ProductScopeControl activeProductId={state.activeProductId} />
        <Spacer />
        <AppHeaderUserMenu showPresenceMenuItem={state.showPresenceMenuItem} />
      </HStack>
      <Box flex={1} minHeight={0}>
        <SideMenuDensityProvider density="compact">
          <SidebarContent
            surface={state.activeProductId ?? "settings"}
            showExpanded
            fullWidth
          />
        </SideMenuDensityProvider>
      </Box>
    </Box>
  );
}
