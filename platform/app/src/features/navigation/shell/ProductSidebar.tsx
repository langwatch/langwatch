import { Badge, Box, Kbd, VStack } from "@chakra-ui/react";
import { ArrowLeft, Search } from "lucide-react";
import { useRef, useState } from "react";
import { MainMenuSections } from "~/components/MainMenu";
import { PersonalSidebarLinks } from "~/components/PersonalSidebar";
import { SidebarSection } from "~/components/sidebar/SidebarSection";
import { SideMenuItem, SideMenuLink } from "~/components/sidebar/SideMenuLink";
import { SupportMenu } from "~/components/sidebar/SupportMenu";
import { SideMenuDensityProvider } from "~/components/sidebar/sideMenuDensity";
import { ThemeToggle } from "~/components/sidebar/ThemeToggle";
import { UsageIndicator } from "~/components/sidebar/UsageIndicator";
import { useMenuScrollPosition } from "~/components/sidebar/useMenuScrollPosition";
import { useCommandBar } from "~/features/command-bar";
import { getCommandBarShortcut } from "~/features/command-bar/utils/platform";
import { APP_HEADER_HEIGHT } from "@langwatch/langy-web";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePathname } from "~/utils/compat/next-navigation";
import { featureIcons } from "~/utils/featureIcons";
import { readLastVisitedProduct } from "../logic/productMemory";
import { resolveSettingsBackTarget } from "../logic/resolveSettingsBackTarget";
import { isPathUnder, type ProductId } from "../products";
import {
  gatewayNavItems,
  governanceNavItems,
  type SectionNavItemData,
} from "../sectionNavItems";
import { useLlmOpsProjectSlug } from "../useLlmOpsProjectSlug";
import { useReachableProducts } from "../useReachableProducts";
import { isSettingsMenuItemActive, useSettingsMenu } from "../useSettingsMenu";
import { useVisibleSectionNavItems } from "../useVisibleSectionNavItems";
import { QUIET_SIDEBAR_CHIP } from "./quietChipStyle";
import { SHELL_SIDEBAR_WIDTH_COMPACT, SHELL_SIDEBAR_WIDTH_EXPANDED } from "./shellLayout";

export type SidebarSurface = ProductId | "settings";

/**
 * Quick Search as the first sidebar entry in the navigation-v2 shells,
 * opening the same command bar the header trigger and Cmd+K open.
 *
 * Spec: specs/navigation/product-sidebars.feature
 */
function QuickSearchMenuItem({ showLabel }: { showLabel: boolean }) {
  const { open } = useCommandBar();
  return (
    <Box
      as="button"
      width={showLabel ? "full" : "auto"}
      textAlign="left"
      cursor="pointer"
      aria-label="Quick Search"
      onClick={open}
    >
      <SideMenuItem
        icon={Search}
        label="Quick Search"
        showLabel={showLabel}
        rightElement={
          <Kbd
            variant="outline"
            fontSize="10px"
            fontWeight="normal"
            background="bg.muted"
            {...QUIET_SIDEBAR_CHIP}
          >
            {getCommandBarShortcut()}
          </Kbd>
        }
      />
    </Box>
  );
}

/**
 * The pinned utility block at the bottom of every navigation-v2 sidebar:
 * usage, Settings, Support (with the human chat folded in) and the theme
 * control. The Settings sidebar drops its own entry, since the back
 * entry above already frames it.
 */
function SidebarBottomBlock({
  showExpanded,
  shouldIncludeSettingsLink,
}: {
  showExpanded: boolean;
  shouldIncludeSettingsLink: boolean;
}) {
  const pathname = usePathname();
  const { hasPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

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
      {shouldIncludeSettingsLink && hasPermission("organization:view") && (
        <SideMenuLink
          icon={featureIcons.settings.icon}
          label="Settings"
          href="/settings"
          isActive={isPathUnder({ pathname, base: "/settings" })}
          showLabel={showExpanded}
        />
      )}
      <SupportMenu showLabel={showExpanded} chatPlacement="in-menu" />
      <ThemeToggle showLabel={showExpanded} />
    </VStack>
  );
}

/**
 * The way out of Settings: back to the page the user came from in this
 * tab, else the remembered product's home. First entry of the Settings
 * sidebar.
 *
 * Spec: specs/navigation/settings-shell-v2.feature
 */
function SettingsBackEntry({ showLabel }: { showLabel: boolean }) {
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const { reachableProducts } = useReachableProducts();
  const projectSlug = useLlmOpsProjectSlug();
  const target = resolveSettingsBackTarget({
    organizationId: organization?.id ?? null,
    rememberedProduct: organization
      ? readLastVisitedProduct({ organizationId: organization.id })
      : null,
    reachableProducts,
    projectSlug,
  });

  return (
    <Box
      width="full"
      paddingX={1}
      borderBottomWidth="1px"
      borderBottomColor="border"
      paddingBottom={2.5}
    >
      <SideMenuLink
        icon={ArrowLeft}
        label={target.label}
        href={target.href}
        showLabel={showLabel}
      />
    </Box>
  );
}

/**
 * The Settings sidebar body: the regrouped, iconed settings menu with
 * the same gates the legacy settings navigation applies. Enterprise
 * entries carry the quiet grey pill.
 */
function SettingsMenuBody({ showExpanded }: { showExpanded: boolean }) {
  const pathname = usePathname();
  const groups = useSettingsMenu();

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
              rightElement={
                item.isEnterprise ? (
                  <Badge
                    title="Enterprise plan feature"
                    variant="outline"
                    fontSize="8.5px"
                    fontWeight="semibold"
                    letterSpacing="0.06em"
                    textTransform="uppercase"
                    {...QUIET_SIDEBAR_CHIP}
                  >
                    ENT
                  </Badge>
                ) : undefined
              }
            />
          ))}
        </SidebarSection>
      ))}
    </>
  );
}

/**
 * The Gateway and Governance sidebar bodies: the same registry data the
 * legacy section rails render, promoted to first-class sidebar entries.
 */
function SectionItemsNav({
  items,
  showExpanded,
}: {
  items: readonly SectionNavItemData[];
  showExpanded: boolean;
}) {
  const pathname = usePathname();
  const visibleItems = useVisibleSectionNavItems(items);
  return (
    <>
      {visibleItems.map((item) => (
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
        />
      ))}
    </>
  );
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
  if (surface === "me") {
    return (
      <PersonalSidebarLinks
        showExpanded={showExpanded}
        shouldIncludeGovernSection={false}
      />
    );
  }
  if (surface === "gateway") {
    return <SectionItemsNav items={gatewayNavItems} showExpanded={showExpanded} />;
  }
  if (surface === "governance") {
    return <SectionItemsNav items={governanceNavItems} showExpanded={showExpanded} />;
  }
  return (
    <MainMenuSections
      showExpanded={showExpanded}
      shouldIncludeGovernSection={false}
      shouldIncludeOpsSection={false}
    />
  );
}

/**
 * Everything inside the sidebar column: the way back on Settings, Quick
 * Search, the surface's own pages, and the bottom block pinned under
 * them. Laid out at the expanded width whatever the column is showing,
 * so a collapsing column slides the same content out of view instead of
 * reflowing it. The mobile menu reuses it at the full viewport width.
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
      {/* The way back out of Settings sits above the scroll region, so a
          long settings menu never scrolls it out of the column. */}
      {surface === "settings" && (
        <Box width="full" paddingX={2}>
          <SettingsBackEntry showLabel={showExpanded} />
        </Box>
      )}

      {/* The scroll region spans the full column and carries the
          horizontal inset itself, so its scrollbar runs against the
          content panel instead of floating a padding away from it.

          Its edges meet the rules above and below it, so the entries are
          cut exactly at a line rather than a few pixels before it. The
          space that holds them off those lines is padding in here, which
          the entries travel through as the menu moves. */}
      <VStack
        ref={scrollRegionRef}
        data-testid="sidebar-scroll-region"
        width="full"
        paddingX={3}
        paddingTop={surface === "settings" ? 1.5 : 0}
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
          "&::-webkit-scrollbar": { width: "4px" },
          "&::-webkit-scrollbar-thumb": {
            background: "var(--chakra-colors-border-emphasized)",
            borderRadius: "2px",
          },
          "&::-webkit-scrollbar-track": { background: "transparent" },
        }}
      >
        <QuickSearchMenuItem showLabel={showExpanded} />
        <Box height={2} width="full" flexShrink={0} />
        <ProductSidebarBody surface={surface} showExpanded={showExpanded} />
      </VStack>

      <Box width="full" paddingX={2}>
        <SidebarBottomBlock
          showExpanded={showExpanded}
          shouldIncludeSettingsLink={surface !== "settings"}
        />
      </Box>
    </VStack>
  );
}

/**
 * The navigation-v2 sidebar frame, shared by the product-switcher and
 * icon-rail shells: a wider column than the current chrome's, drawn one
 * step tighter so the longer page names hold one line. It never
 * auto-hides; only small screens keep the hover-expanded responsive
 * collapse the legacy chrome has.
 *
 * Specs: specs/navigation/product-sidebars.feature,
 *        specs/navigation/settings-shell-v2.feature
 */
export function ProductSidebar({
  surface,
  isCompact,
}: {
  surface: SidebarSurface;
  isCompact: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const showExpanded = !isCompact || isHovered;
  const columnWidth = isCompact
    ? SHELL_SIDEBAR_WIDTH_COMPACT
    : SHELL_SIDEBAR_WIDTH_EXPANDED;
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
          width={
            showExpanded ? SHELL_SIDEBAR_WIDTH_EXPANDED : SHELL_SIDEBAR_WIDTH_COMPACT
          }
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
