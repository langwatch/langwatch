/** Sidebar column: product pages and utilities. Host and search palette integration. */

import { RawKbd as Kbd } from "@langwatch/design-system/kbd";
import { Badge, Box, VStack } from "@langwatch/design-system/primitives";
import { ScrollEdgeFade, useScrollEdges } from "@langwatch/design-system/scroll-fade";
import { FrontendFlags } from "@langwatch/feature-flag-contract";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import { ArrowLeft, ArrowUpRight, Search } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { InsightsNavCount } from "../../behavior/lent-insights.tsx";
import { SavedDashboards, StarredDashboards } from "../../behavior/lent-saved-dashboards.tsx";
import { useAdminMenu } from "../../behavior/use-admin-menu.ts";
import { useLlmOpsProjectSlug } from "../../behavior/use-llm-ops-project-slug.ts";
import { useMenuScrollPosition } from "../../behavior/use-menu-scroll-position.ts";
import { useOpsAttentionCount } from "../../behavior/use-ops-attention-count.ts";
import { useReachableProducts } from "../../behavior/use-reachable-products.ts";
import { useSettingsMenu } from "../../behavior/use-settings-menu.ts";
import { useVisibleSectionNavItems } from "../../behavior/use-visible-section-nav-items.ts";
import { featureIcons } from "../../model/feature-icons.ts";
import { APP_HEADER_HEIGHT } from "../../model/menu-widths.ts";
import { useNavigationHost } from "../../model/navigation-host.ts";
import { readLastVisitedProduct } from "../../model/product-memory.ts";
import {
  isAdminShellRoute,
  isPathUnder,
  OPERATIONS_CONSOLE,
  type ProductId,
} from "../../model/products.ts";
import {
  dashboardsAreaAt,
  projectNavItems,
  toProjectRoutePattern,
} from "../../model/project-nav-items.ts";
import { projectScopedDestination } from "../../model/project-scoped-nav.ts";
import { QUIET_SIDEBAR_CHIP } from "../../model/quiet-chip-style.ts";
import { resolveSettingsBackTarget } from "../../model/resolve-settings-back-target.ts";
import {
  gatewayNavItems,
  governanceNavItems,
  type SectionNavItemData,
} from "../../model/section-nav-items.ts";
import {
  isSettingsMenuItemActive,
  OPS_ATTENTION_HREF,
  type SettingsMenuGroup,
} from "../../model/settings-menu.ts";
import {
  SHELL_SIDEBAR_WIDTH_COMPACT,
  SHELL_SIDEBAR_WIDTH_EXPANDED,
} from "../../model/shell-layout.ts";
import { SideMenuItem, SideMenuLink } from "../blocks/side-menu-link.tsx";
import { SupportMenu } from "../blocks/support-menu.tsx";
import { ThemeToggle } from "../blocks/theme-toggle.tsx";
import { SideMenuDensityProvider } from "../elements/side-menu-density.tsx";
import { MainMenuSections } from "./main-menu.tsx";
import { PersonalSidebarLinks } from "./personal-sidebar.tsx";
import { SidebarSection } from "./sidebar-section.tsx";
import { UsageIndicator } from "./usage-indicator.tsx";

export type SidebarSurface = ProductId | "settings" | "admin";

/** The sidebar a page outside every product draws: the Admin console on /ops, else Settings. */
export function detourSurface(pathname: string): SidebarSurface {
  return isAdminShellRoute(pathname) ? "admin" : "settings";
}

/**
 * Quick Search as the first sidebar entry in the navigation-v2 shells,
 * opening the same command bar as Cmd+K
 * (product-sidebars.feature).
 */
function QuickSearchMenuItem({ showLabel }: { showLabel: boolean }) {
  const commandBar = useNavigationHost().commandBar();
  // A host with no palette gets no entry rather than one that opens nothing.
  if (!commandBar) return null;
  return (
    <Box
      as="button"
      width={showLabel ? "full" : "auto"}
      textAlign="left"
      cursor="pointer"
      aria-label="Quick Search"
      onClick={commandBar.open}
      borderRadius="lg"
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "colorPalette.focusRing",
        outlineOffset: "-2px",
      }}
    >
      <SideMenuItem
        icon={Search}
        label="Quick Search"
        showLabel={showLabel}
        rightElement={
          <Kbd
            variant="outline"
            textStyle="micro"
            fontWeight="normal"
            background="bg.muted"
            {...QUIET_SIDEBAR_CHIP}
          >
            {commandBar.shortcut}
          </Kbd>
        }
      />
    </Box>
  );
}

/**
 * The pinned utility block at the bottom of every sidebar: usage, Settings,
 * Support and the theme control, with a product's own pinned entry just
 * above Settings. The Settings sidebar drops its own entry since the top bar
 * already names it.
 */
function SidebarBottomBlock({
  showExpanded,
  shouldIncludeSettingsLink,
  productPinned,
}: {
  showExpanded: boolean;
  shouldIncludeSettingsLink: boolean;
  productPinned?: ReactNode;
}) {
  const host = useNavigationHost();
  const pathname = host.pathname();

  return (
    <VStack
      data-testid="sidebar-bottom-block"
      width="full"
      gap={0.5}
      align="start"
      borderTopWidth="1px"
      borderTopColor="border"
      paddingTop={2}
      // The rule is the block's top edge, so it runs a step wider than the
      // entries it separates. That step is padding, not a negative margin:
      // the box already fills the column, so a negative margin would move
      // its left edge and leave the right one where it was.
      paddingX={1}
    >
      <UsageIndicator showLabel={showExpanded} />
      {productPinned}
      {shouldIncludeSettingsLink && host.hasPermission("organization:view") && (
        <SideMenuLink
          icon={featureIcons.settings.icon}
          label="Settings"
          href="/settings"
          isActive={isPathUnder({ pathname, base: "/settings" })}
          showLabel={showExpanded}
        />
      )}
      <SupportMenu showLabel={showExpanded} />
      <ThemeToggle showLabel={showExpanded} />
    </VStack>
  );
}

/**
 * The way out of Settings: back to the page the user came from in this
 * tab, else the remembered product's home (settings-shell-v2.feature).
 */
function SettingsBackEntry({ showLabel }: { showLabel: boolean }) {
  const host = useNavigationHost();
  const organization = host.organization();
  const { reachableProducts } = useReachableProducts();
  const projectSlug = useLlmOpsProjectSlug();
  // Refused /ops view: the remembered product is not where the viewer came from.
  const isRefusedOps = isPathUnder({ pathname: host.pathname(), base: "/ops" });
  if (isRefusedOps && !host.opsAccess().hasAccess) return null;
  const target = resolveSettingsBackTarget({
    organizationId: organization?.id ?? null,
    rememberedProduct: organization
      ? readLastVisitedProduct({ organizationId: organization.id })
      : null,
    reachableProducts,
    projectSlug,
  });

  return (
    <SideMenuLink icon={ArrowLeft} label={target.label} href={target.href} showLabel={showLabel} />
  );
}

/** A detour's grouped menu (Settings, Admin): sentence-case groups, one entry lit by prefix. */
function DetourMenuBody({
  groups,
  showExpanded,
  badgeFor,
}: {
  groups: SettingsMenuGroup[];
  showExpanded: boolean;
  badgeFor?: (href: string) => number | undefined;
}) {
  const pathname = useNavigationHost().pathname();

  return (
    <>
      {groups.map((group) => (
        <SidebarSection
          key={group.id}
          id={group.id}
          label={group.label}
          showExpanded={showExpanded}
        >
          {group.items.map((item) => (
            <SideMenuLink
              key={item.href}
              icon={item.icon}
              label={item.label}
              href={item.href}
              isActive={isSettingsMenuItemActive({ item, pathname })}
              showLabel={showExpanded}
              badgeNumber={badgeFor?.(item.href)}
              isLocked={item.isLocked}
              rightElement={item.isEnterprise ? <EnterpriseChip /> : undefined}
            />
          ))}
        </SidebarSection>
      ))}
    </>
  );
}

/** The Settings sidebar body, with the same gates the legacy settings navigation applies. */
function SettingsMenuBody({ showExpanded }: { showExpanded: boolean }) {
  const hasOpsAccess = useNavigationHost().opsAccess().hasAccess;
  return (
    <>
      <DetourMenuBody groups={useSettingsMenu()} showExpanded={showExpanded} />
      {/* The operator pages left Settings for their own console; operators get a signpost. */}
      {hasOpsAccess && (
        <>
          <Box flex={1} width="full" />
          <SideMenuLink
            icon={OPERATIONS_CONSOLE.icon}
            label="Ops have moved"
            href={OPERATIONS_CONSOLE.href}
            showLabel={showExpanded}
            rightElement={<OutboundArrow />}
          />
        </>
      )}
    </>
  );
}

/** The Admin console's sidebar body; the operations badge sits on its dashboard. */
function AdminMenuBody({ showExpanded }: { showExpanded: boolean }) {
  const opsAttentionCount = useOpsAttentionCount();
  return (
    <DetourMenuBody
      groups={useAdminMenu()}
      showExpanded={showExpanded}
      badgeFor={(href) => (href === OPS_ATTENTION_HREF ? opsAttentionCount : void 0)}
    />
  );
}

/**
 * The Gateway and Governance sidebar bodies: the same registry data the
 * legacy section rails render, promoted to first-class sidebar entries.
 */
function SectionItemsNav({
  items,
  sectionPath,
  showExpanded,
}: {
  items: readonly SectionNavItemData[];
  sectionPath: string;
  showExpanded: boolean;
}) {
  const pathname = useNavigationHost().pathname();
  const visibleItems = useVisibleSectionNavItems(items);
  const ungrouped = visibleItems.filter((item) => item.group === undefined);
  const groups = new Map<string, SectionNavItemData[]>();
  for (const item of visibleItems) {
    if (item.group === undefined) continue;
    groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  }
  const renderLink = (item: SectionNavItemData) => (
    <SideMenuLink
      key={item.href}
      icon={item.icon}
      label={item.label}
      href={item.href}
      isActive={
        item.includePath
          ? isPathUnder({ pathname, base: item.includePath })
          : pathname === item.href
      }
      showLabel={showExpanded}
      tourId={item.tourId}
      rightElement={
        isPathUnder({ pathname: item.href, base: sectionPath }) ? undefined : <OutboundArrow />
      }
    />
  );
  return (
    <>
      {ungrouped.map(renderLink)}
      {/* The groups sit at the foot of the column, above the bottom block,
          so the product's own pages stay in one place at the top. */}
      {groups.size > 0 && <Box flex={1} width="full" />}
      {[...groups.entries()].map(([group, groupItems]) => (
        <SidebarSection
          key={group}
          id={group.toLowerCase()}
          label={group}
          showExpanded={showExpanded}
        >
          {groupItems.map(renderLink)}
        </SidebarSection>
      ))}
    </>
  );
}

/**
 * The Dashboards sidebar body: only the saved-dashboards list analytics lends,
 * with the board the address opens marked (dashboards-v1.feature).
 */
function DashboardsSidebarBody({ showExpanded }: { showExpanded: boolean }) {
  const host = useNavigationHost();
  if (!showExpanded) return null;
  const pattern = toProjectRoutePattern({
    pathname: host.pathname(),
    projectSlug: host.project()?.slug,
  });
  return <SavedDashboards openPath={dashboardsAreaAt(pattern)?.openPath} />;
}

/**
 * The one Insights entry, in every product menu's bottom block just above Settings.
 * Hidden until `release_insights` and `release_dashboards` answer on (the page lives in
 * Dashboards and is closed without it), and on an aggregate project, which files no insight;
 * the unread pill is the one insight lends.
 * @see modules/insight/specs/insight-inbox.feature
 */
function InsightsMenuLink({ showExpanded }: { showExpanded: boolean }) {
  const host = useNavigationHost();
  const insights = host.featureFlag(FrontendFlags.release_insights);
  const dashboards = host.featureFlag(FrontendFlags.release_dashboards);
  if (insights.isLoading || !insights.enabled) return null;
  if (dashboards.isLoading || !dashboards.enabled) return null;
  if (!host.hasPermission("analytics:view")) return null;
  if (isAggregateProjectKind(host.project()?.kind)) return null;
  const destination = projectScopedDestination({
    path: projectNavItems.insights.path,
    label: projectNavItems.insights.title,
    project: host.project(),
  });
  return (
    <SideMenuLink
      icon={featureIcons.insights.icon}
      label={projectNavItems.insights.title}
      href={destination.href}
      unavailableReason={destination.unavailableReason}
      isActive={isPathUnder({
        pathname: toProjectRoutePattern({
          pathname: host.pathname(),
          projectSlug: host.project()?.slug,
        }),
        base: projectNavItems.insights.path,
      })}
      showLabel={showExpanded}
      rightElement={<InsightsNavCount />}
    />
  );
}

/**
 * The member's starred dashboards in every other product's sidebar, for a member who can reach
 * Dashboards; Dashboards lists its stars itself, and Settings is no product.
 */
function StarredDashboardsGroup({
  surface,
  showExpanded,
}: {
  surface: SidebarSurface;
  showExpanded: boolean;
}) {
  const { reachableProducts } = useReachableProducts();
  if (!showExpanded || surface === "dashboards" || surface === "settings") return null;
  if (!reachableProducts.includes("dashboards")) return null;
  return <StarredDashboards />;
}

function ProductSidebarBody({
  surface,
  showExpanded,
}: {
  surface: SidebarSurface;
  showExpanded: boolean;
}) {
  if (surface === "settings") {
    return <SettingsMenuBody showExpanded={showExpanded} />;
  }
  if (surface === "admin") {
    return <AdminMenuBody showExpanded={showExpanded} />;
  }
  if (surface === "me") {
    return <PersonalSidebarLinks showExpanded={showExpanded} />;
  }
  if (surface === "gateway") {
    return (
      <SectionItemsNav items={gatewayNavItems} sectionPath="/gateway" showExpanded={showExpanded} />
    );
  }
  if (surface === "dashboards") {
    return <DashboardsSidebarBody showExpanded={showExpanded} />;
  }
  if (surface === "governance") {
    return (
      <SectionItemsNav
        items={governanceNavItems}
        sectionPath="/governance"
        showExpanded={showExpanded}
      />
    );
  }
  return <MainMenuSections showExpanded={showExpanded} />;
}

/**
 * Everything inside the sidebar column, laid out at the expanded width
 * whatever the column shows, so collapsing slides it out of view instead
 * of reflowing it. The mobile menu reuses it at full viewport width.
 */
export function SidebarContent({
  surface,
  showExpanded,
  isFullWidth = false,
}: {
  surface: SidebarSurface;
  showExpanded: boolean;
  isFullWidth?: boolean;
}) {
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const scrollEdges = useScrollEdges({ axis: "y" });
  // Keyed by surface: each product's menu keeps its own place, and moving
  // between products never restores the place of the menu left behind.
  useMenuScrollPosition({ regionRef: scrollRegionRef, menuKey: surface });

  return (
    <VStack
      paddingTop={2}
      paddingBottom={2}
      gap={0}
      height="100%"
      align="start"
      width={isFullWidth ? "full" : SHELL_SIDEBAR_WIDTH_EXPANDED}
      justifyContent="space-between"
    >
      <Box
        data-testid="sidebar-search-row"
        width="full"
        paddingX={3}
        paddingBottom={2}
        flexShrink={0}
      >
        <QuickSearchMenuItem showLabel={showExpanded} />
      </Box>

      {(surface === "settings" || surface === "admin") && (
        <Box
          data-testid="sidebar-back-row"
          width="full"
          paddingX={3}
          paddingBottom={2}
          flexShrink={0}
        >
          <SettingsBackEntry showLabel={showExpanded} />
        </Box>
      )}

      {/* Padding lives on this region, not its children, so the scrollbar
          runs against the content panel and entries are cut exactly at
          the rules above and below rather than a few pixels short. */}
      {/* The fades say the menu scrolls: entries hide under the rules above and below. */}
      <Box position="relative" flex={1} minHeight={0} width="full" display="flex">
        <VStack
          ref={(node: HTMLDivElement | null) => {
            scrollRegionRef.current = node;
            scrollEdges.ref(node);
          }}
          data-testid="sidebar-scroll-region"
          data-tour="sidebar"
          width="full"
          paddingX={3}
          paddingTop={0}
          paddingBottom={2}
          gap={0.5}
          align="start"
          flex={1}
          minHeight={0}
          overflowY="auto"
          overflowX="hidden"
          css={{
            // No standard scrollbar-width here: Chromium treats it as an
            // opt out of the ::-webkit-scrollbar styling below, and the
            // native bar it falls back to is a wide one with a track.
            // Firefox takes its default scrollbar instead.
            "&::-webkit-scrollbar": { width: "10px" },
            "&::-webkit-scrollbar-thumb": {
              background: "var(--chakra-colors-border-emphasized)",
              backgroundClip: "padding-box",
              border: "3px solid transparent",
              borderRadius: "999px",
            },
            "&::-webkit-scrollbar-track": { background: "transparent", marginBlock: "1.5" },
          }}
        >
          <ProductSidebarBody surface={surface} showExpanded={showExpanded} />
          <StarredDashboardsGroup surface={surface} showExpanded={showExpanded} />
        </VStack>
        <ScrollEdgeFade edge="top" visible={scrollEdges.start} color="bg.page" />
        <ScrollEdgeFade edge="bottom" visible={scrollEdges.end} color="bg.page" />
      </Box>

      <Box width="full" paddingX={2}>
        <SidebarBottomBlock
          showExpanded={showExpanded}
          shouldIncludeSettingsLink={surface !== "settings"}
          productPinned={
            surface === "settings" || surface === "admin" ? null : (
              <InsightsMenuLink showExpanded={showExpanded} />
            )
          }
        />
      </Box>
    </VStack>
  );
}

/** Sidebar frame for product-switcher and icon-rail. Wider; hover-collapse on small screens. */
export function ProductSidebar({
  surface,
  isCompact,
}: {
  surface: SidebarSurface;
  isCompact: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const showExpanded = !isCompact || isHovered;
  const columnWidth = isCompact ? SHELL_SIDEBAR_WIDTH_COMPACT : SHELL_SIDEBAR_WIDTH_EXPANDED;
  const fullHeight = `calc(100vh - ${APP_HEADER_HEIGHT}px)`;

  return (
    <SideMenuDensityProvider density="compact">
      <Box
        data-testid="product-sidebar"
        background="bg.page"
        width={columnWidth}
        minWidth={columnWidth}
        height={fullHeight}
        position="relative"
        onMouseEnter={() => isCompact && setIsHovered(true)}
        onMouseLeave={() => isCompact && setIsHovered(false)}
      >
        <Box
          position={isCompact ? "absolute" : "relative"}
          zIndex={isCompact ? 100 : "auto"}
          top={0}
          left={0}
          width={showExpanded ? SHELL_SIDEBAR_WIDTH_EXPANDED : SHELL_SIDEBAR_WIDTH_COMPACT}
          height={fullHeight}
          background="bg.page"
          transition="width 0.15s ease-in-out"
          overflow="hidden"
        >
          <SidebarContent surface={surface} showExpanded={showExpanded} />
        </Box>
      </Box>
    </SideMenuDensityProvider>
  );
}

/** Marks an entry that leaves the current section. */
function OutboundArrow() {
  return <ArrowUpRight size={12} aria-hidden color="var(--chakra-colors-fg-muted)" />;
}

/** The quiet "ENT" chip on an Enterprise entry the plan includes; a locked entry shows a lock. */
function EnterpriseChip() {
  return (
    <Badge
      title="Enterprise plan feature"
      variant="outline"
      textStyle="micro"
      fontWeight="semibold"
      letterSpacing="0.06em"
      textTransform="uppercase"
      {...QUIET_SIDEBAR_CHIP}
    >
      ENT
    </Badge>
  );
}
