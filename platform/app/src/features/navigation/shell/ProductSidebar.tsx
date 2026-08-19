import { Badge, Box, Kbd, VStack } from "@chakra-ui/react";
import { ArrowLeft, ExternalLink, Search } from "lucide-react";
import { useState } from "react";
import { MainMenuSections } from "~/components/MainMenu";
import { PersonalSidebarLinks } from "~/components/PersonalSidebar";
import { SideMenuItem, SideMenuLink } from "~/components/sidebar/SideMenuLink";
import { SideMenuSectionLabel } from "~/components/sidebar/SideMenuSectionLabel";
import { SupportMenu } from "~/components/sidebar/SupportMenu";
import { SideMenuDensityProvider } from "~/components/sidebar/sideMenuDensity";
import { ThemeToggle } from "~/components/sidebar/ThemeToggle";
import { UsageIndicator } from "~/components/sidebar/UsageIndicator";
import { useCommandBar } from "~/features/command-bar";
import { getCommandBarShortcut } from "~/features/command-bar/utils/platform";
import { APP_HEADER_HEIGHT } from "~/features/langy/logic/langyPanelLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRouter } from "~/utils/compat/next-router";
import { featureIcons } from "~/utils/featureIcons";
import { readLastVisitedProduct } from "../logic/productMemory";
import { resolveSettingsBackTarget } from "../logic/resolveSettingsBackTarget";
import { isPathUnder, type ProductId } from "../products";
import {
  gatewayNavItems,
  governanceNavItems,
  type SectionNavItemData,
} from "../sectionNavItems";
import { useReachableProducts } from "../useReachableProducts";
import { useSettingsMenu } from "../useSettingsMenu";
import { QUIET_SIDEBAR_CHIP } from "./quietChipStyle";
import {
  SHELL_SIDEBAR_WIDTH_COMPACT,
  SHELL_SIDEBAR_WIDTH_EXPANDED,
} from "./shellLayout";

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
  const router = useRouter();
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
      marginTop={2}
      // The rule reads as the edge of the block, so it runs a little
      // wider than the items it separates.
      marginX="-4px"
      paddingX="4px"
    >
      <UsageIndicator showLabel={showExpanded} />
      {shouldIncludeSettingsLink && hasPermission("organization:view") && (
        <SideMenuLink
          icon={featureIcons.settings.icon}
          label="Settings"
          href="/settings"
          isActive={isPathUnder({
            pathname: router.pathname,
            base: "/settings",
          })}
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
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const { reachableProducts } = useReachableProducts();
  const target = resolveSettingsBackTarget({
    organizationId: organization?.id ?? null,
    rememberedProduct: organization
      ? readLastVisitedProduct({ organizationId: organization.id })
      : null,
    reachableProducts,
    projectSlug: project && !project.isPersonal ? project.slug : null,
  });

  return (
    <Box
      width="full"
      borderBottomWidth="1px"
      borderBottomColor="border"
      paddingBottom={2.5}
      marginBottom={1.5}
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
  const router = useRouter();
  const groups = useSettingsMenu();

  return (
    <>
      {groups.map((group) => (
        <VStack key={group.label} width="full" gap={0.5} align="start">
          {showExpanded && (
            <Box
              color="gray.500"
              paddingX={2}
              paddingTop={2.5}
              paddingBottom={0.5}
            >
              <SideMenuSectionLabel label={group.label} />
            </Box>
          )}
          {group.items.map((item) => (
            <SideMenuLink
              key={item.href}
              icon={item.icon}
              label={item.label}
              href={item.href}
              isActive={
                (item.alsoActiveAt?.includes(router.pathname) ?? false) ||
                (item.isExactMatch
                  ? router.pathname === item.href
                  : router.pathname.startsWith(item.includePath ?? item.href))
              }
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
        </VStack>
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
  const router = useRouter();
  return (
    <>
      {items.map((item) => (
        <SideMenuLink
          key={item.href}
          icon={item.icon}
          label={item.label}
          href={item.href}
          isActive={
            item.includePath
              ? router.pathname.startsWith(item.includePath)
              : router.pathname === item.href
          }
          showLabel={showExpanded}
          isExternal={item.isExternal}
          rightElement={
            item.isExternal ? <ExternalLink size={12} aria-hidden /> : undefined
          }
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
    return (
      <SectionItemsNav items={gatewayNavItems} showExpanded={showExpanded} />
    );
  }
  if (surface === "governance") {
    return (
      <SectionItemsNav items={governanceNavItems} showExpanded={showExpanded} />
    );
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
 * reflowing it.
 */
function SidebarContent({
  surface,
  showExpanded,
}: {
  surface: SidebarSurface;
  showExpanded: boolean;
}) {
  return (
    <VStack
      paddingX={3}
      paddingTop={2}
      paddingBottom={2}
      gap={0}
      height="100%"
      align="start"
      width={SHELL_SIDEBAR_WIDTH_EXPANDED}
      justifyContent="space-between"
    >
      <VStack
        width="full"
        gap={0.5}
        align="start"
        flex={1}
        minHeight={0}
        overflowY="auto"
        overflowX="hidden"
        css={{
          scrollbarWidth: "thin",
          "&::-webkit-scrollbar": { width: "4px" },
          "&::-webkit-scrollbar-thumb": {
            background: "var(--chakra-colors-border-emphasized)",
            borderRadius: "2px",
          },
          "&::-webkit-scrollbar-track": { background: "transparent" },
        }}
      >
        {surface === "settings" && (
          <SettingsBackEntry showLabel={showExpanded} />
        )}
        <QuickSearchMenuItem showLabel={showExpanded} />
        <Box height={2} width="full" flexShrink={0} />
        <ProductSidebarBody surface={surface} showExpanded={showExpanded} />
      </VStack>

      <SidebarBottomBlock
        showExpanded={showExpanded}
        shouldIncludeSettingsLink={surface !== "settings"}
      />
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
            showExpanded
              ? SHELL_SIDEBAR_WIDTH_EXPANDED
              : SHELL_SIDEBAR_WIDTH_COMPACT
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
