/**
 * Application chrome: top bar, sidebar, content. Mode: product-switcher or icon-rail.
 * Drawer mounted separately (portal-based). Moved from platform/app; DashboardLayout deleted.
 */

import { Box, HStack } from "@chakra-ui/react";
import { useEffect, type ReactNode } from "react";

import {
  useNavigationShellState,
  type NavigationShellReadyState,
} from "../../behavior/use-navigation-shell-state.ts";
import { APP_HEADER_HEIGHT } from "../../model/menu-widths.ts";
import { useNavigationHost } from "../../model/navigation-host.ts";
import { shellContentMaxWidth } from "../../model/shell-layout.ts";
import { ICON_RAIL_WIDTH, IconRail } from "./icon-rail.tsx";
import { MobileShell } from "./mobile-shell.tsx";
import { ProductSidebar } from "./product-sidebar.tsx";
import { ShellPageBody } from "./shell-page-body.tsx";
import { ShellTopBar } from "./shell-top-bar.tsx";

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
 * The document's title, composed from the project and the open
 * destination — moved off a `next/head` shim a governed package may not
 * import. The host writes it and restores what a shell found on unmount.
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
      <ProductSidebar surface={activeProductId ?? "settings"} isCompact={isCompactSidebar} />

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
          data-tour="main-content"
        >
          {children}
        </Box>
      </Box>
    </HStack>
  );
}
