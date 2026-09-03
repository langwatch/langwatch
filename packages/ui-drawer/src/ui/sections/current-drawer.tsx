/**
 * The one place a URL-addressed drawer is mounted.
 *
 * Moved out of `platform/app/src/components/CurrentDrawer.tsx`. It reads
 * `?drawer.open=<name>` off the address, resolves the component through the
 * registry the host composed, and hands it the three sources of props the
 * navigator keeps: the `drawer.<key>` query parameters, the in-memory complex
 * props, and the flow callbacks registered for that drawer.
 *
 * TWO PLATFORM READS BECAME ONE PROP. The application's own copy asked
 * `useOrganizationTeamProject` for the reader's organization role and drove
 * `platform/app`'s upgrade-modal store when an EXTERNAL member addressed a
 * restricted drawer. Neither module has a package export, and both are the
 * HOST's policy rather than the drawer framework's, so the whole rule arrives
 * as one optional `restriction` prop: the host says which drawer a reader may
 * not open and what to do instead. Nothing passed means nothing is restricted,
 * which is what a host with no membership tiers wants.
 */

import { Center, Spinner } from "@chakra-ui/react";
import { DrawerOffsetProvider } from "@langwatch/design-system/drawer";
import qs from "qs";
import { Suspense, useEffect, useMemo, useSyncExternalStore } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { useDrawerRouter } from "../../behavior/drawer-router";
import {
  getComplexProps,
  getDrawerPropsVersion,
  getFlowCallbacks,
  subscribeDrawerProps,
} from "../../behavior/use-drawer";
import type { UiDrawerRegistry } from "../../model/drawer-registry";
import { URL_QS_PARSE_OPTIONS } from "../../model/qs-parse-options";

/**
 * The host's rule about who may open what.
 *
 * `blocks` answers with the restricted RESOURCE — the word the host's own
 * upsell names — or `undefined` when the drawer is open to this reader.
 */
export type CurrentDrawerRestriction = {
  blocks: (drawer: string) => string | undefined;
  onBlocked?: (resource: string) => void;
};

type QueryDrawer = {
  open: string;
} & Record<string, unknown>;

export type CurrentDrawerProps = {
  /** The composed registry: every drawer this application installed. */
  drawers: UiDrawerRegistry;
  marginTop?: number;
  restriction?: CurrentDrawerRestriction;
};

export function CurrentDrawer({ drawers, marginTop, restriction }: CurrentDrawerProps) {
  const router = useDrawerRouter();
  // Re-render when complexProps changes without a URL change (e.g. reload
  // re-hydration of a comparison editor's context) so the getComplexProps()
  // read below picks the new value up. Only setComplexProps notifies this
  // subscription — setFlowCallbacks deliberately does not (see its own
  // comment) — but callers pair a setFlowCallbacks with a following
  // setComplexProps on the same re-hydration path, so the getFlowCallbacks()
  // read below still picks up fresh callbacks on the render that triggers.
  useSyncExternalStore(subscribeDrawerProps, getDrawerPropsVersion, getDrawerPropsVersion);
  const queryString = router.asPath.split("?")[1] ?? "";
  // qs.parse + the `drawer.*` slice is recomputed on every render otherwise,
  // handing the rendered drawer a fresh props object each time and cascading
  // a re-render through its subtree even when nothing drawer-relevant changed.
  const queryDrawer = useMemo<QueryDrawer | undefined>(() => {
    const parsed = qs.parse(queryString.replaceAll("%2C", ","), URL_QS_PARSE_OPTIONS);
    return parsed.drawer as QueryDrawer | undefined;
  }, [queryString]);

  const drawerType = queryDrawer?.open;

  // Intercept restricted drawers. Instead of rendering the drawer, tell the
  // host and clear the drawer from the URL. This protects ALL entry points:
  // direct clicks, command bar, deep links, and any future call sites.
  const restrictedResource = drawerType && restriction ? restriction.blocks(drawerType) : undefined;

  useEffect(() => {
    if (!restrictedResource) return;

    restriction?.onBlocked?.(restrictedResource);

    // Clear drawer from URL so it doesn't persist in browser history.
    router.push(
      "?" +
        qs.stringify(
          Object.fromEntries(
            Object.entries(router.query).filter(([key]) => !key.startsWith("drawer.")),
          ),
        ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restrictedResource]);

  const CurrentDrawerComponent =
    drawerType && !restrictedResource
      ? (drawers[drawerType] as React.FC<Record<string, unknown>> | undefined)
      : undefined;

  // Dev warning: detect duplicate drawer rendering via DOM check
  useEffect(() => {
    if (!drawerType || process.env.NODE_ENV !== "development") return;

    // Check after render settles
    const timer = setTimeout(() => {
      const drawerElements = document.querySelectorAll(
        '[data-scope="drawer"][data-part="positioner"]',
      );
      if (drawerElements.length > 1) {
        console.warn(
          `[Drawer Duplicate] Multiple drawer positioners found (${drawerElements.length}). ` +
            `"${drawerType}" may be rendered both by CurrentDrawer and explicitly in a page. ` +
            `Remove the explicit drawer - CurrentDrawer handles it globally.`,
        );
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [drawerType]);

  // Get props from multiple sources:
  // 1. URL query params (serializable props)
  // 2. complexProps (per-drawer non-serializable props)
  // 3. flowCallbacks (persistent callbacks across navigation)
  const complexProps = getComplexProps();
  const flowCallbacksForDrawer = drawerType ? getFlowCallbacks(drawerType) : undefined;

  const offsetValue = useMemo(() => ({ marginTop }), [marginTop]);

  if (!CurrentDrawerComponent) return null;

  return (
    <DrawerOffsetProvider value={offsetValue}>
      <ErrorBoundary
        resetKeys={[drawerType]}
        fallback={null}
        onError={() => {
          router.push(
            "?" +
              qs.stringify(
                Object.fromEntries(
                  Object.entries(router.query).filter(([key]) => !key.startsWith("drawer.")),
                ),
              ),
          );
        }}
      >
        <Suspense fallback={<DrawerLoadingFallback />}>
          <CurrentDrawerComponent {...queryDrawer} {...complexProps} {...flowCallbacksForDrawer} />
        </Suspense>
      </ErrorBoundary>
    </DrawerOffsetProvider>
  );
}

function DrawerLoadingFallback() {
  // CurrentDrawer is mounted in the page's normal flow; the real drawers
  // render through a portal, so this fallback is the only piece that
  // would take layout space. Keep it position-fixed (where the drawer
  // will appear) or the whole page jumps down while the chunk loads.
  return (
    <Center
      position="fixed"
      top={0}
      right={0}
      bottom={0}
      width="120px"
      zIndex="overlay"
      pointerEvents="none"
    >
      <Spinner size="lg" color="blue.500" />
    </Center>
  );
}
