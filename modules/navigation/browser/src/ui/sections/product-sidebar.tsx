/** Sidebar column: product pages and utilities. Host and search palette integration. */

import type { DashboardHomeProduct, StarredDashboardsProject } from "@langwatch/analytics-client";
import { permissionSatisfiedBy } from "@langwatch/authorization";
import { RawKbd as Kbd } from "@langwatch/design-system/kbd";
import { Box, VStack } from "@langwatch/design-system/primitives";
import { ResizeHandle } from "@langwatch/design-system/resize-handle";
import { ScrollEdgeFade, useScrollEdges } from "@langwatch/design-system/scroll-fade";
import { useFeatureFlag } from "@langwatch/feature-flag-client";
import { FrontendFlags } from "@langwatch/feature-flag-contract";
import { ArrowLeft, ArrowUpRight, LayoutDashboard, Search } from "lucide-react";
import { useRef, useState } from "react";

import {
  ProductDashboards,
  SavedDashboards,
  StarredDashboards,
} from "../../behavior/lent-saved-dashboards.tsx";
import { navigationApi } from "../../behavior/navigation-api.ts";
import { useSidebarWidthStore } from "../../behavior/sidebar-width.store.ts";
import { useAdminMenu } from "../../behavior/use-admin-menu.ts";
import { useLlmOpsProject, useLlmOpsProjectSlug } from "../../behavior/use-llm-ops-project-slug.ts";
import { useMenuScrollPosition } from "../../behavior/use-menu-scroll-position.ts";
import { useOpsAttentionCount } from "../../behavior/use-ops-attention-count.ts";
import {
  useHasOrganizationLibrary,
  useOrganizationLibrary,
} from "../../behavior/use-product-home.ts";
import { useReachableProducts } from "../../behavior/use-reachable-products.ts";
import { useSettingsEntryHref } from "../../behavior/use-settings-entry-href.ts";
import { useSettingsMenu } from "../../behavior/use-settings-menu.ts";
import { useVisibleSectionNavItems } from "../../behavior/use-visible-section-nav-items.ts";
import { featureIcons } from "../../model/feature-icons.ts";
import { APP_HEADER_HEIGHT } from "../../model/menu-widths.ts";
import { useNavigationHost } from "../../model/navigation-host.ts";
import { readLastVisitedProduct } from "../../model/product-memory.ts";
import {
  isAdminShellRoute,
  isOrganizationDashboardsPath,
  isOrganizationLibraryPath,
  isPathUnder,
  OPERATIONS_CONSOLE,
  ORGANIZATION_DASHBOARDS_PATH,
  type ProductId,
} from "../../model/products.ts";
import { dashboardsAreaAt, toProjectRoutePattern } from "../../model/project-nav-items.ts";
import { QUIET_SIDEBAR_CHIP } from "../../model/quiet-chip-style.ts";
import { resolveSettingsBackTarget } from "../../model/resolve-settings-back-target.ts";
import {
  gatewayNavItems,
  governanceNavItems,
  type SectionNavItemData,
} from "../../model/section-nav-items.ts";
import {
  isSettingsMenuItemActiveAmong,
  OPS_ATTENTION_HREF,
  type SettingsMenuGroup,
} from "../../model/settings-menu.ts";
import {
  SHELL_SIDEBAR_WIDTH_COMPACT,
  SHELL_SIDEBAR_WIDTH_EXPANDED,
  SHELL_SIDEBAR_WIDTH_MAX,
  SHELL_SIDEBAR_WIDTH_MIN,
  shellSidebarWidth,
} from "../../model/shell-layout.ts";
import { SideMenuItem, SideMenuLink } from "../blocks/side-menu-link.tsx";
import { SupportMenu } from "../blocks/support-menu.tsx";
import { ThemeToggle } from "../blocks/theme-toggle.tsx";
import { featureMenuIcon } from "../elements/feature-menu-icon.tsx";
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
 * Support and the theme control. The Settings sidebar drops its own entry
 * since the top bar already names it.
 */
function SidebarBottomBlock({
  showExpanded,
  shouldIncludeSettingsLink,
}: {
  showExpanded: boolean;
  shouldIncludeSettingsLink: boolean;
}) {
  const host = useNavigationHost();
  const pathname = host.pathname();
  const settingsHref = useSettingsEntryHref();

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
      {shouldIncludeSettingsLink && host.hasPermission("organization:view") && (
        <SideMenuLink
          icon={featureIcons.settings.icon}
          label="Settings"
          href={settingsHref}
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
  const hasOrganizationLibrary = useHasOrganizationLibrary();
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
    hasOrganizationLibrary,
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
  const host = useNavigationHost();
  const pathname = host.pathname();
  const search = host.search();

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
              icon={item.feature ? featureMenuIcon(item.feature) : item.icon}
              label={item.label}
              href={item.href}
              isActive={isSettingsMenuItemActiveAmong({
                item,
                siblings: group.items,
                pathname,
                search,
              })}
              showLabel={showExpanded}
              badgeNumber={badgeFor?.(item.href)}
              isLocked={item.isLocked}
              isEnterpriseIncluded={item.isEnterpriseIncluded}
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
  const hasOrganizationArea = useOrganizationLibrary();
  if (isOrganizationDashboardsPath(host.pathname())) {
    return <OrganizationDashboardsSidebarBody showExpanded={showExpanded} />;
  }
  const pattern = toProjectRoutePattern({
    pathname: host.pathname(),
    projectSlug: host.project()?.slug,
  });
  if (!showExpanded || hasOrganizationArea === void 0) return null;
  // The pinned list is the flag-off sidebar; with the area on, boards list as in every product.
  if (hasOrganizationArea) return <ProductDashboards product="llm-ops" />;
  return <SavedDashboards openPath={dashboardsAreaAt(pattern)?.openPath} />;
}

/**
 * The Dashboards sidebar in the organization's area: the library alone. Templates read LLM Ops
 * data, so they are offered only in LLM Ops (owner, 2026-11-23).
 */
function OrganizationDashboardsSidebarBody({ showExpanded }: { showExpanded: boolean }) {
  const host = useNavigationHost();
  return (
    <SideMenuLink
      icon={LayoutDashboard}
      label="All dashboards"
      href={ORGANIZATION_DASHBOARDS_PATH}
      isActive={isOrganizationLibraryPath(host.pathname())}
      showLabel={showExpanded}
    />
  );
}

/** The sidebars that may show the Dashboards section only with every product's flag on. */
const DASHBOARDS_SECTION_FLAGGED_SURFACES: ReadonlySet<SidebarSurface> = new Set(["gateway", "me"]);

/** Main's cadence: a role changed elsewhere reaches the section within a focus. */
const GRANTS_STALE_TIME_MS = 30_000;

/**
 * The Dashboards section analytics lends. With the organization's area on, each product lists its
 * own boards (ADR-002, decision 8); off, LLM Ops keeps the pinned section. Outside LLM Ops both
 * ask `release_dashboards_in_every_product` too.
 */
function SidebarDashboardsSection({
  surface,
  showExpanded,
}: {
  surface: SidebarSurface;
  showExpanded: boolean;
}) {
  const host = useNavigationHost();
  const { reachableProducts } = useReachableProducts();
  const hasOrganizationArea = useOrganizationLibrary();
  const everyProduct = host.featureFlag(FrontendFlags.release_dashboards_in_every_product);
  if (!showExpanded || hasOrganizationArea === void 0) return null;
  if (surface === "llm-ops") {
    if (!reachableProducts.includes("dashboards")) return null;
    return hasOrganizationArea ? <ProductDashboards product="llm-ops" /> : <StarredDashboards />;
  }
  if (!everyProduct.enabled) return null;
  const product = homeProductOf(surface);
  if (hasOrganizationArea) return product ? <ProductDashboards product={product} /> : null;
  if (!DASHBOARDS_SECTION_FLAGGED_SURFACES.has(surface)) return null;
  return <InLlmOpsProject />;
}

/** The sidebars that list their own boards, each surface its own home product. */
const HOME_PRODUCT_SURFACES: ReadonlyMap<SidebarSurface, DashboardHomeProduct> = new Map([
  ["llm-ops", "llm-ops"],
  ["me", "me"],
  ["gateway", "gateway"],
  ["governance", "governance"],
]);

function homeProductOf(surface: SidebarSurface): DashboardHomeProduct | undefined {
  return HOME_PRODUCT_SURFACES.get(surface);
}

/** Gateway and Coding agents with the area off: the section works in the project LLM Ops opens. */
function InLlmOpsProject() {
  const llmOpsProject = useLlmOpsProject();
  if (!llmOpsProject) return null;
  const { id, slug, name } = llmOpsProject;
  return <StarredDashboardsInProject project={{ id, slug, name }} />;
}

/** Released and granted per project: the section follows the one it works in, not the page's. */
function StarredDashboardsInProject({ project }: { project: StarredDashboardsProject }) {
  // LLM Ops only opens a project in the page's organization, so that organization targets it;
  // until it is known an organization rollout can only answer no, so the read waits for it.
  const organizationId = useNavigationHost().organization()?.id;
  const released = useFeatureFlag(FrontendFlags.release_dashboards, {
    projectId: project.id,
    organizationId,
    enabled: organizationId !== undefined,
  });
  const standing = navigationApi.authz.effectivePermissions.useQuery(
    { projectId: project.id },
    { staleTime: GRANTS_STALE_TIME_MS },
  );
  const granted = standing.data?.permissions;
  if (!released.enabled || !granted) return null;
  if (!permissionSatisfiedBy({ granted: new Set(granted), requested: "analytics:view" })) {
    return null;
  }
  return <StarredDashboards project={project} />;
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
  expandedWidth = SHELL_SIDEBAR_WIDTH_EXPANDED,
}: {
  surface: SidebarSurface;
  showExpanded: boolean;
  isFullWidth?: boolean;
  /** The width the reader dragged the column to, when they did. */
  expandedWidth?: string;
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
      width={isFullWidth ? "full" : expandedWidth}
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
          <SidebarDashboardsSection surface={surface} showExpanded={showExpanded} />
        </VStack>
        <ScrollEdgeFade edge="top" visible={scrollEdges.start} color="bg.page" />
        <ScrollEdgeFade edge="bottom" visible={scrollEdges.end} color="bg.page" />
      </Box>

      <Box width="full" paddingX={2}>
        <SidebarBottomBlock
          showExpanded={showExpanded}
          shouldIncludeSettingsLink={surface !== "settings"}
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
  const { rememberedWidth, setRememberedWidth, resetWidth } = useSidebarWidthStore();
  const showExpanded = !isCompact || isHovered;
  // The dragged width is the wide screen's: small screens keep their hover-out column.
  const draggedWidth = shellSidebarWidth({ remembered: rememberedWidth });
  const expandedWidth = isCompact ? SHELL_SIDEBAR_WIDTH_EXPANDED : `${draggedWidth}px`;
  const columnWidth = isCompact ? SHELL_SIDEBAR_WIDTH_COMPACT : expandedWidth;
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
          width={showExpanded ? expandedWidth : SHELL_SIDEBAR_WIDTH_COMPACT}
          height={fullHeight}
          background="bg.page"
          transition={isCompact ? "width 0.15s ease-in-out" : void 0}
          overflow="hidden"
        >
          <SidebarContent
            surface={surface}
            showExpanded={showExpanded}
            expandedWidth={expandedWidth}
          />
        </Box>
        {!isCompact && (
          <ResizeHandle
            label="Resize sidebar"
            value={draggedWidth}
            min={SHELL_SIDEBAR_WIDTH_MIN}
            max={SHELL_SIDEBAR_WIDTH_MAX}
            onChange={setRememberedWidth}
            onReset={resetWidth}
          />
        )}
      </Box>
    </SideMenuDensityProvider>
  );
}

/** Marks an entry that leaves the current section. */
function OutboundArrow() {
  return <ArrowUpRight size={12} aria-hidden color="var(--chakra-colors-fg-muted)" />;
}
