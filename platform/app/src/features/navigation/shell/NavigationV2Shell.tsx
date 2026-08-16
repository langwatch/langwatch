import { Box, HStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import type { DashboardLayoutProps } from "~/components/DashboardLayout";
import { DashboardPageBody } from "~/components/DashboardPageBody";
import { LoadingScreen } from "~/components/LoadingScreen";
import { MENU_WIDTH_COMPACT, MENU_WIDTH_EXPANDED } from "~/components/MainMenu";
import { NotFoundScene } from "~/components/NotFoundScene";
import {
  APP_HEADER_HEIGHT,
  LANGY_TRANSITION,
} from "~/features/langy/logic/langyPanelLayout";
import Head from "~/utils/compat/next-head";
import { ICON_RAIL_WIDTH, IconRail } from "./IconRail";
import { ProductSidebar } from "./ProductSidebar";
import { ShellTopBar } from "./ShellTopBar";
import {
  type NavigationV2ShellReadyState,
  useNavigationV2ShellState,
} from "./useNavigationV2ShellState";

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
  const state = useNavigationV2ShellState({ personalScope, orgScope });

  if (state.status === "not-found") return <NotFoundScene />;
  if (state.status === "loading") return <LoadingScreen />;

  const isIconRail = mode === "icon-rail";

  return (
    <Box
      width="full"
      minHeight="100vh"
      background="bg.page"
      overflowX={["auto", "auto", "hidden"]}
      display="flex"
      alignItems="stretch"
    >
      <ShellHead pageTitle={pageTitle} state={state} />

      {isIconRail && (
        <IconRail
          activeProductId={state.activeProductId}
          isSettingsActive={state.isSettingsRoute}
        />
      )}

      <Box flex={1} minWidth={0}>
        <ShellTopBar state={state} showProductCluster={!isIconRail} />

        <ShellContentRow state={state} isIconRail={isIconRail}>
          <DashboardPageBody personalScope={personalScope} {...props}>
            {children}
          </DashboardPageBody>
        </ShellContentRow>
      </Box>
    </Box>
  );
};

function ShellHead({
  pageTitle,
  state,
}: {
  pageTitle: DashboardLayoutProps["pageTitle"];
  state: NavigationV2ShellReadyState;
}) {
  const { project, currentRoute } = state;

  return (
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
  );
}

/**
 * The sidebar and the content card below the top bar. The content card
 * keeps room on its right for the docked Langy panel, and closes its
 * right edge when the panel takes that room.
 */
function ShellContentRow({
  state,
  isIconRail,
  children,
}: {
  state: NavigationV2ShellReadyState;
  isIconRail: boolean;
  children: ReactNode;
}) {
  const { activeProductId, isCompactSidebar, langyDockInset } = state;
  const menuWidth = isCompactSidebar ? MENU_WIDTH_COMPACT : MENU_WIDTH_EXPANDED;
  const contentInsetWidth = isIconRail
    ? `${menuWidth} - ${ICON_RAIL_WIDTH}`
    : menuWidth;

  return (
    <HStack
      width="full"
      alignItems="stretch"
      gap={0}
      minHeight={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
    >
      <ProductSidebar
        surface={activeProductId ?? "settings"}
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
          {children}
        </Box>
      </Box>
    </HStack>
  );
}
