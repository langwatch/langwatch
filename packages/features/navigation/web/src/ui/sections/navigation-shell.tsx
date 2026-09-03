/**
 * THE APPLICATION CHROME. One component: the top bar, the product sidebar, the
 * content card and the page body inside it.
 *
 * Moved from
 * `platform/app/src/features/navigation/shell/NavigationV2Shell.tsx`, which is
 * the shape `DashboardLayout` resolved to for every device on a current
 * navigation mode. `DashboardLayout` itself is DELETED rather than moved: its
 * own body was the legacy chrome — breadcrumbs built from a route table that
 * no longer exists, a workspace switcher, a passkey nudge, an analytics
 * identify — and nothing on this side mounts it. What a host renders now is
 * this.
 *
 * The mode is still a parameter, because the icon rail and the product
 * switcher are two arrangements of the same chrome: in "product-switcher" the
 * product lives in a top-bar dropdown beside the mark; in "icon-rail" a
 * full-height rail on the left carries the mark and one tile per product, and
 * the dropdown disappears. The sidebar never auto-hides in either; only a
 * small viewport collapses it.
 *
 * THE DRAWER MOUNT IS NOT HERE, and that is deliberate. `CurrentDrawer` is
 * mounted once by the application's own chrome route, above the outlet and
 * outside this frame: a drawer is addressed by the query string and renders
 * through a portal, so it has to open over a page this shell does not draw as
 * well as over one it does.
 *
 * Specs: specs/navigation/product-switcher-navigation.feature,
 *        specs/navigation/icon-rail-navigation.feature,
 *        specs/navigation/product-sidebars.feature
 */

import { Box, HStack } from "@chakra-ui/react";
import { useEffect, type ReactNode } from "react";
import {
  useNavigationShellState,
  type NavigationShellReadyState,
} from "../../behavior/use-navigation-shell-state";
import { APP_HEADER_HEIGHT } from "../../model/menu-widths";
import { useNavigationHost } from "../../model/navigation-host";
import { shellContentMaxWidth } from "../../model/shell-layout";
import { ICON_RAIL_WIDTH, IconRail } from "./icon-rail";
import { MobileShell } from "./mobile-shell";
import { ProductSidebar } from "./product-sidebar";
import { ShellPageBody } from "./shell-page-body";
import { ShellTopBar } from "./shell-top-bar";

export type NavigationShellProps = {
  children: ReactNode;
  /** The two arrangements of this chrome. */
  mode?: "product-switcher" | "icon-rail";
  /** Personal-scope addresses need no organization to draw the chrome. */
  personalScope?: boolean;
  /** Organization-scope addresses need no project to draw the chrome. */
  orgScope?: boolean;
  /** Overrides the title this shell would compose from the address. */
  pageTitle?: string;
};

export function NavigationShell({
  children,
  mode = "product-switcher",
  personalScope = false,
  orgScope = false,
  pageTitle,
}: NavigationShellProps) {
  const host = useNavigationHost();
  const state = useNavigationShellState({
    isPersonalScope: personalScope,
    isOrgScope: orgScope,
  });

  if (state.status === "not-found") return <>{host.notFound()}</>;
  if (state.status === "loading") return <>{host.waiting()}</>;

  const isIconRail = mode === "icon-rail";

  // A phone has room for the page or the chrome, not both: one compact bar and
  // a full-screen menu replace the sidebar and the rail in both modes.
  if (state.isMobile) {
    return (
      <Box width="full" minHeight="100vh" background="bg.page">
        <ShellTitle pageTitle={pageTitle} state={state} />
        <MobileShell state={state}>
          <ShellPageBody personalScope={personalScope}>{children}</ShellPageBody>
        </MobileShell>
      </Box>
    );
  }

  return (
    <Box
      width="full"
      minHeight="100vh"
      background="bg.page"
      overflowX={["auto", "auto", "hidden"]}
      display="flex"
      alignItems="stretch"
    >
      <ShellTitle pageTitle={pageTitle} state={state} />

      {isIconRail && (
        <IconRail
          activeProductId={state.activeProductId}
          isSettingsActive={state.isSettingsRoute}
        />
      )}

      <Box flex={1} minWidth={0}>
        <ShellTopBar state={state} shouldShowProductCluster={!isIconRail} />

        <ShellContentRow state={state} isIconRail={isIconRail}>
          <ShellPageBody personalScope={personalScope}>{children}</ShellPageBody>
        </ShellContentRow>
      </Box>
    </Box>
  );
}

/**
 * The document's title, composed from the project and the open destination.
 *
 * `<Head><title>` in the module this moved from, which is a `next/head` shim
 * a governed web package may not import and a browser has no equivalent of.
 * The host writes it and hands back the way to put it back, so a shell that
 * unmounts leaves the title it found.
 */
function ShellTitle({
  pageTitle,
  state,
}: {
  pageTitle: string | undefined;
  state: NavigationShellReadyState;
}) {
  const host = useNavigationHost();
  const { project, currentRoute } = state;
  const title =
    pageTitle ??
    `LangWatch${project ? ` - ${project.name}` : ""}${
      currentRoute && currentRoute.title !== "Home" ? ` - ${currentRoute.title}` : ""
    }`;

  // Called as a method rather than through a lifted reference: the port is a
  // CLASS, and an unbound `host.setDocumentTitle` loses the receiver its own
  // fields hang off.
  useEffect(() => host.setDocumentTitle(title), [host, title]);

  return null;
}

/**
 * The sidebar and the content card below the top bar.
 */
function ShellContentRow({
  state,
  isIconRail,
  children,
}: {
  state: NavigationShellReadyState;
  isIconRail: boolean;
  children: ReactNode;
}) {
  const { activeProductId, isCompactSidebar, menuWidth } = state;
  // The rail is a sibling of this column, so its width is room the page does
  // not have, the same as the sidebar's.
  const contentMaxWidth = shellContentMaxWidth({
    menuWidth,
    railWidth: isIconRail ? ICON_RAIL_WIDTH : null,
  });

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
        data-testid="shell-content-column"
        width="full"
        height="full"
        background="bg.page"
        minHeight={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
        maxHeight={`calc(100vh - ${APP_HEADER_HEIGHT}px)`}
        maxWidth={contentMaxWidth}
      >
        <Box
          width="full"
          height="full"
          background="bg.surface"
          borderTopLeftRadius="xl"
          borderTopWidth="1px"
          borderLeftWidth="1px"
          borderStyle="solid"
          // In light mode `border.muted` is the same grey as `bg.page`, so the
          // panel edge needs the stronger token to read at all. Dark keeps the
          // muted one, which already contrasts against the page there.
          borderColor="border"
          _dark={{
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07)",
            borderColor: "border.muted",
          }}
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
