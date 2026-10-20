/** Top bar: org/product scope (left); dev badge, search and account controls (right). */

import { AppTopBar } from "@langwatch/design-system/app-shell";
import { LogoIcon } from "@langwatch/design-system/logo-icon";
import { HStack, Text } from "@langwatch/design-system/primitives";
import { Settings as SettingsIcon } from "lucide-react";

import { InsightsBell } from "../../behavior/lent-insights.tsx";
import type { NavigationShellReadyState } from "../../behavior/use-navigation-shell-state.ts";
import { APP_HEADER_HEIGHT } from "../../model/menu-widths.ts";
import { useNavigationHost } from "../../model/navigation-host.ts";
import { isAdminShellRoute, OPERATIONS_CONSOLE, type ProductId } from "../../model/products.ts";
import { DevBadge } from "../elements/dev-badge.tsx";
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
  const commandBar = host.commandBar();
  // The product cluster spans the sidebar column, so the organization and
  // the scope start at the left edge of the content column and stay there
  // whatever the product label is. A compact sidebar is narrower than the
  // product pill, so there the cluster keeps its own width.
  const clusterWidth = state.isCompactSidebar ? undefined : state.menuWidth;

  return (
    <AppTopBar
      height={APP_HEADER_HEIGHT}
      glow={topBarGlow({ impersonating: Boolean(user?.impersonator), showDevelopmentIndicator })}
      flushLeft={shouldShowProductCluster}
      leading={
        shouldShowProductCluster ? (
          <ProductCluster activeProductId={activeProductId} width={clusterWidth} />
        ) : undefined
      }
      controls={
        <>
          <OrganizationSelect activeProductId={activeProductId} />
          <ProductScopeControl activeProductId={activeProductId} />
        </>
      }
      trailing={
        <>
          {showDevelopmentIndicator && <DevBadge label={host.deployment().devIndicatorLabel} />}
          {accountMenu?.headerBanner}
          <InsightsBell />
          {/* Home already has its own search and the sidebar's Quick Search. */}
          {state.project && state.currentRoute?.title !== "Home" && commandBar?.trigger}
          <AppHeaderUserMenu />
        </>
      }
    />
  );
}

/** An operator viewing as someone outranks a development build. */
function topBarGlow({
  impersonating,
  showDevelopmentIndicator,
}: {
  impersonating: boolean;
  showDevelopmentIndicator: boolean;
}): "impersonating" | "development" | undefined {
  if (impersonating) return "impersonating";
  return showDevelopmentIndicator ? "development" : undefined;
}

function ProductCluster({
  activeProductId,
  width,
}: {
  activeProductId: ProductId | null;
  width: string | undefined;
}) {
  const isAdmin = isAdminShellRoute(useNavigationHost().pathname());
  const DetourIcon = isAdmin ? OPERATIONS_CONSOLE.icon : SettingsIcon;
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
        <LogoIcon height={LOGO_HEIGHT} forceColorMode="light" />
      </NavigationLink>
      {activeProductId ? (
        <ProductSwitcherMenu activeProductId={activeProductId} />
      ) : (
        // Settings and the Operations console are detours, not products to switch between; the
        // way out is the sidebar's back entry. The switcher pill's inset keeps the icon in place.
        <HStack gap={2} paddingX={2.5} height="28px">
          <DetourIcon size={14} color="var(--chakra-colors-fg-muted)" />
          <Text textStyle="label">{isAdmin ? OPERATIONS_CONSOLE.label : "Settings"}</Text>
        </HStack>
      )}
    </HStack>
  );
}
