import { Box, HStack, Text, useBreakpointValue } from "@chakra-ui/react";
import { useLayoutEffect } from "react";
import { AppHeaderUserMenu } from "~/components/AppHeaderUserMenu";
import type { DashboardLayoutProps } from "~/components/DashboardLayout";
import { DashboardPageBody } from "~/components/DashboardPageBody";
import { LogoIcon } from "~/components/icons/LogoIcon";
import { LoadingScreen } from "~/components/LoadingScreen";
import { MENU_WIDTH_COMPACT, MENU_WIDTH_EXPANDED } from "~/components/MainMenu";
import { NotFoundScene } from "~/components/NotFoundScene";
import { Link } from "~/components/ui/link";
import { CommandBarTrigger } from "~/features/command-bar";
import {
  APP_HEADER_HEIGHT,
  LANGY_DOCK_GAP,
  LANGY_DOCKED_OFFSET,
  LANGY_TRANSITION,
} from "~/features/langy/logic/langyPanelLayout";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useOrgQueryParamSelection } from "~/hooks/useOrgQueryParamSelection";
import { usePostHogIdentify } from "~/hooks/usePostHogIdentify";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import Head from "~/utils/compat/next-head";
import { useRouter } from "~/utils/compat/next-router";
import { findCurrentRoute } from "~/utils/routes";
import { ImpersonationBanner } from "../../../../ee/admin/ImpersonationBanner";
import { productFromPathname } from "../products";
import { ICON_RAIL_WIDTH, IconRail } from "./IconRail";
import { OrganizationSelect } from "./OrganizationSelect";
import { ProductScopeControl } from "./ProductScopeControl";
import { ProductSidebar } from "./ProductSidebar";
import { ProductSwitcherMenu } from "./ProductSwitcherMenu";

/**
 * The navigation-v2 shell, one component for both new modes. The top
 * bar carries the organization and the product-native scope; the
 * sidebar holds only the active product's pages. In "product-switcher"
 * the product lives in a top-bar dropdown next to the logo; in
 * "icon-rail" a full-height rail on the left carries the logo and one
 * tile per product, and the dropdown disappears. Mounted by
 * DashboardLayout when the device mode resolves to a new mode on a
 * product route. The sidebar never auto-hides in these shells; small
 * screens keep the responsive collapse the legacy chrome has.
 *
 * Specs: specs/navigation/product-switcher-navigation.feature,
 *        specs/navigation/icon-rail-navigation.feature,
 *        specs/navigation/product-sidebars.feature
 */
export const NavigationV2Shell = ({
  mode,
  children,
  personalScope = false,
  orgScope = false,
  pageTitle,
  // Auto-hide requests from pages are deliberately ignored in the new
  // modes; only the viewport collapses the sidebar.
  compactMenu: _compactMenu,
  publicPage: _publicPage,
  ...props
}: DashboardLayoutProps & { mode: "product-switcher" | "icon-rail" }) => {
  const isSmallScreen = useBreakpointValue(
    { base: true, lg: false },
    { fallback: "lg" },
  );
  const router = useRouter();

  useOrgQueryParamSelection();

  const { data: session } = useRequiredSession();

  const bypassProjectGating = personalScope || orgScope;
  const {
    isLoading,
    organization,
    organizations,
    team,
    project,
    hasPermission,
  } = useOrganizationTeamProject({
    redirectToOnboarding: !bypassProjectGating,
    redirectToProjectOnboarding: !bypassProjectGating,
  });
  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization && hasPermission("organization:view"),
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );
  const publicEnv = usePublicEnv();

  usePostHogIdentify({
    session: session ?? null,
    organization,
    planType: usage.data?.activePlan?.type,
  });

  // Same dock handshake as the legacy shell: claim the dock so the
  // page-level wrapper stands down, and reserve the docked Langy panel's
  // room inside the content row only.
  const langyDockShifted = useLangyStore((s) => s.dockShifted);
  const claimDockShell = useLangyStore((s) => s.claimDockShell);
  const releaseDockShell = useLangyStore((s) => s.releaseDockShell);
  useLayoutEffect(() => {
    claimDockShell();
    return releaseDockShell;
  }, [claimDockShell, releaseDockShell]);
  const langyDockInset = langyDockShifted
    ? LANGY_DOCKED_OFFSET + LANGY_DOCK_GAP
    : 0;

  if (typeof router.query.project === "string" && !isLoading && !project) {
    return <NotFoundScene />;
  }

  const isOnOwnPersonalProject =
    !!team?.isPersonal && team.ownerUserId === session?.user?.id;
  const isPersonalScopeRoute =
    personalScope ||
    router.pathname.startsWith("/me") ||
    isOnOwnPersonalProject;
  const activeProductId =
    (isPersonalScopeRoute ? "me" : productFromPathname(router.pathname)) ??
    "llm-ops";
  const isOrgScopeRoute =
    orgScope ||
    activeProductId === "gateway" ||
    activeProductId === "governance";

  if (
    !session ||
    isLoading ||
    (!isPersonalScopeRoute && (!organization || !organizations)) ||
    (!isPersonalScopeRoute &&
      !isOrgScopeRoute &&
      !organization?.primaryIntent &&
      (!team || !project))
  ) {
    return <LoadingScreen />;
  }

  const user = session.user;
  const currentRoute = findCurrentRoute(router.pathname);
  const isIconRail = mode === "icon-rail";
  const isCompactSidebar = isSmallScreen === true;
  const menuWidth = isCompactSidebar ? MENU_WIDTH_COMPACT : MENU_WIDTH_EXPANDED;
  const contentInsetWidth = isIconRail
    ? `${menuWidth} - ${ICON_RAIL_WIDTH}`
    : menuWidth;
  const showPresenceMenuItem = router.pathname.startsWith("/[project]/traces");

  return (
    <Box
      width="full"
      minHeight="100vh"
      background="bg.page"
      overflowX={["auto", "auto", "hidden"]}
      display="flex"
      alignItems="stretch"
    >
      <Head>
        <title>
          {pageTitle ?? (
            <>
              LangWatch{project ? ` - ${project.name}` : ""}
              {currentRoute && currentRoute.title !== "Home"
                ? ` - ${currentRoute?.title}`
                : ""}
            </>
          )}
        </title>
      </Head>

      {isIconRail && (
        <IconRail
          activeProductId={activeProductId}
          isSettingsActive={router.pathname.startsWith("/settings")}
        />
      )}

      <Box flex={1} minWidth={0}>
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
          {(user?.impersonator ||
            publicEnv.data?.NODE_ENV === "development") && (
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
            {!isIconRail && (
              <>
                <Link href="/" display="flex" alignItems="center">
                  <LogoIcon width={25 * 0.7} height={32 * 0.7} />
                </Link>
                <ProductSwitcherMenu activeProductId={activeProductId} />
              </>
            )}
            <OrganizationSelect activeProductId={activeProductId} />
            <ProductScopeControl activeProductId={activeProductId} />
          </HStack>

          <HStack gap={2} justifyContent="flex-end" overflow="hidden">
            {publicEnv.data?.NODE_ENV === "development" && (
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
            )}
            {user && <ImpersonationBanner user={user} />}
            {project && <CommandBarTrigger />}
            <AppHeaderUserMenu showPresenceMenuItem={showPresenceMenuItem} />
          </HStack>
        </HStack>

        <HStack
          width="full"
          alignItems="stretch"
          gap={0}
          minHeight={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
        >
          <ProductSidebar
            activeProductId={activeProductId}
            isCompact={isCompactSidebar}
          />

          <Box
            width="full"
            height="full"
            background="bg.page"
            minHeight={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
            maxHeight={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
            maxWidth={`calc(100vw - ${contentInsetWidth})`}
            paddingRight={`${langyDockInset}px`}
            transition={`padding-right ${LANGY_TRANSITION}`}
          >
            <Box
              width="full"
              height="full"
              background="bg.surface"
              borderTopLeftRadius="xl"
              borderTopWidth="1px"
              borderLeftWidth="1px"
              borderStyle="solid"
              borderColor="border.muted"
              borderTopRightRadius={langyDockInset > 0 ? "xl" : 0}
              borderRightWidth={langyDockInset > 0 ? "1px" : 0}
              _dark={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07)" }}
              overflow="auto"
              display="flex"
              minHeight={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
              maxHeight={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
              position="relative"
            >
              <DashboardPageBody personalScope={personalScope} {...props}>
                {children}
              </DashboardPageBody>
            </Box>
          </Box>
        </HStack>
      </Box>
    </Box>
  );
};
