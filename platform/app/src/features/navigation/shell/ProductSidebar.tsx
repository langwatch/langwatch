import { Badge, Box, Kbd, Text, VStack } from "@chakra-ui/react";
import { ArrowLeft, ExternalLink, Search } from "lucide-react";
import { useState } from "react";
import {
  MainMenuSections,
  MENU_WIDTH_COMPACT,
  MENU_WIDTH_EXPANDED,
} from "~/components/MainMenu";
import { PersonalSidebarLinks } from "~/components/PersonalSidebar";
import { SideMenuItem, SideMenuLink } from "~/components/sidebar/SideMenuLink";
import { SupportMenu } from "~/components/sidebar/SupportMenu";
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
        rightElement={<Kbd size="sm">{getCommandBarShortcut()}</Kbd>}
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
    <VStack width="full" gap={0.5} align="start">
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
      borderBottomColor="border.muted"
      paddingBottom={1.5}
      marginBottom={1}
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
 * entries carry the violet pill.
 */
function SettingsMenuBody({ showExpanded }: { showExpanded: boolean }) {
  const router = useRouter();
  const groups = useSettingsMenu();

  return (
    <>
      {groups.map((group) => (
        <VStack key={group.label} width="full" gap={0.5} align="start">
          {showExpanded && (
            <Text
              fontSize="11px"
              fontWeight="medium"
              textTransform="uppercase"
              whiteSpace="nowrap"
              color="gray.500"
              paddingX={2}
              paddingTop={2.5}
              paddingBottom={0.5}
            >
              {group.label}
            </Text>
          )}
          {group.items.map((item) => (
            <SideMenuLink
              key={item.href}
              icon={item.icon}
              label={item.label}
              href={item.href}
              isActive={
                item.isExactMatch
                  ? router.pathname === item.href
                  : router.pathname.startsWith(item.includePath ?? item.href)
              }
              showLabel={showExpanded}
              rightElement={
                item.isEnterprise ? (
                  <Badge
                    title="Enterprise plan feature"
                    colorPalette="purple"
                    variant="outline"
                    fontSize="9px"
                    borderRadius="sm"
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
    />
  );
}

/**
 * The navigation-v2 sidebar frame, shared by the product-switcher and
 * icon-rail shells: Quick Search first, the active surface's own pages,
 * and the pinned bottom block. The Settings surface opens with the way
 * back to the product the user came from. It never auto-hides; only
 * small screens keep the hover-expanded responsive collapse the legacy
 * chrome has.
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
  const currentWidth = showExpanded ? MENU_WIDTH_EXPANDED : MENU_WIDTH_COMPACT;

  return (
    <Box
      background="bg.page"
      width={isCompact ? MENU_WIDTH_COMPACT : MENU_WIDTH_EXPANDED}
      minWidth={isCompact ? MENU_WIDTH_COMPACT : MENU_WIDTH_EXPANDED}
      height={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
      position="relative"
      onMouseEnter={() => isCompact && setIsHovered(true)}
      onMouseLeave={() => isCompact && setIsHovered(false)}
    >
      <Box
        position={isCompact ? "absolute" : "relative"}
        zIndex={isCompact ? 100 : "auto"}
        top={0}
        left={0}
        width={currentWidth}
        height={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
        background="bg.page"
        transition="width 0.15s ease-in-out"
        overflow="hidden"
      >
        <VStack
          paddingX={2}
          paddingTop={2}
          paddingBottom={2}
          gap={0}
          height="100%"
          align="start"
          width={MENU_WIDTH_EXPANDED}
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
      </Box>
    </Box>
  );
}
