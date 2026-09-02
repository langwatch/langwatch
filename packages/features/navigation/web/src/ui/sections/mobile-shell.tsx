/**
 * The shell on a phone-width viewport.
 *
 * Moved from `platform/app/src/features/navigation/shell/MobileShell.tsx` as
 * it stood: one compact bar with the logo, the product selector, the product's
 * own scope and a menu button; the page below takes the rest of the screen,
 * and the button opens a full-screen overlay carrying the selectors, the
 * product's pages and the account controls.
 *
 * Spec: specs/navigation/mobile-chrome.feature
 */

import { Box, HStack, IconButton, Spacer, Text } from "@chakra-ui/react";
import { Menu as MenuIcon, Settings as SettingsIcon, X } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import type { NavigationShellReadyState } from "../../behavior/use-navigation-shell-state";
import { APP_HEADER_HEIGHT } from "../../model/menu-widths";
import { useNavigationHost } from "../../model/navigation-host";
import type { ProductId } from "../../model/products";
import { ProductSwitcherMenu } from "../blocks/product-switcher-menu";
import { LogoIcon } from "../elements/logo-icon";
import { NavigationLink } from "../elements/navigation-link";
import { SideMenuDensityProvider } from "../elements/side-menu-density";
import { AppHeaderUserMenu } from "./app-header-user-menu";
import { OrganizationSelect } from "./organization-select";
import { ProductScopeControl } from "./product-scope-control";
import { SidebarContent } from "./product-sidebar";

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
  state: NavigationShellReadyState;
  children: ReactNode;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocus = useRef(false);
  const pathname = useNavigationHost().pathname();

  // A tap on any menu entry navigates, and the new page is the reason
  // the menu was opened, so the overlay stands down on its own.
  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  // The bar is inert while the menu covers it, and an inert element
  // takes no focus, so the button gets it back only after the render
  // that lifts the inert.
  useEffect(() => {
    if (isMenuOpen || !shouldRestoreFocus.current) return;
    shouldRestoreFocus.current = false;
    menuButtonRef.current?.focus();
  }, [isMenuOpen]);

  const closeMenu = () => {
    shouldRestoreFocus.current = true;
    setIsMenuOpen(false);
  };

  return (
    <>
      {/* While the menu covers the screen the page behind it is inert:
          out of the tab order and out of the accessibility tree, so the
          modal keeps both the focus and the reader. */}
      <Box inert={isMenuOpen ? true : undefined}>
        <MobileTopBar
          activeProductId={state.activeProductId}
          isMenuOpen={false}
          onMenuButtonPress={() => setIsMenuOpen(true)}
          menuButtonRef={menuButtonRef}
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
      </Box>
      {isMenuOpen && <MobileMenuOverlay state={state} onClose={closeMenu} />}
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
  onMenuButtonPress,
  menuButtonRef,
}: {
  activeProductId: ProductId | null;
  isMenuOpen: boolean;
  onMenuButtonPress: () => void;
  menuButtonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const showsOwnScope = activeProductId === "llm-ops" || activeProductId === "me";

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
        <NavigationLink href="/" display="flex" alignItems="center" flexShrink={0}>
          <LogoIcon width={LOGO_HEIGHT * (38 / 52)} height={LOGO_HEIGHT} />
        </NavigationLink>
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
        ref={menuButtonRef}
        aria-label={isMenuOpen ? "Close navigation menu" : "Open navigation menu"}
        variant="ghost"
        size="sm"
        onClick={onMenuButtonPress}
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
  state: NavigationShellReadyState;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // The overlay is a modal: it takes focus on open, and Escape closes
  // it the way the close button does.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const overlay = overlayRef.current;
      // A menu the overlay opens portals its list out of this box and
      // takes the focus with it. While it holds the keyboard the keys
      // are its own: Escape closes that menu, not the whole overlay.
      if (ownsKeyboardElsewhere(overlay)) return;
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "Tab") trapTab({ event, overlay });
    };
    // Capture phase: a menu that answers this key restores focus to its
    // own trigger while it handles it, so by the bubble phase the focus
    // no longer says who owned the key.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return (
    <Box
      ref={overlayRef}
      data-testid="mobile-menu-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
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
        onMenuButtonPress={onClose}
        menuButtonRef={closeButtonRef}
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
        <AppHeaderUserMenu />
      </HStack>
      <Box flex={1} minHeight={0}>
        <SideMenuDensityProvider density="compact">
          <SidebarContent
            surface={state.activeProductId ?? "settings"}
            showExpanded
            isFullWidth
          />
        </SideMenuDensityProvider>
      </Box>
    </Box>
  );
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * True while a real element outside the overlay holds the focus, which
 * is what an open portaled menu looks like. An empty focus (the body,
 * or nothing) is not somebody else's keyboard.
 */
function ownsKeyboardElsewhere(overlay: HTMLElement | null) {
  const active = document.activeElement;
  if (!overlay || !active || active === document.body) return false;
  return !overlay.contains(active);
}

/**
 * Keeps Tab and Shift+Tab inside the open menu: the last entry wraps to
 * the first and back.
 */
function trapTab({
  event,
  overlay,
}: {
  event: KeyboardEvent;
  overlay: HTMLElement | null;
}) {
  const active = document.activeElement;
  if (!overlay || !active || !overlay.contains(active)) return;

  const focusable = Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
