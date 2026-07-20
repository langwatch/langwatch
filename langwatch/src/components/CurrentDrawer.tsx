import { Center, Spinner } from "@chakra-ui/react";
import { OrganizationUserRole } from "@prisma/client";
import qs from "qs";
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ErrorBoundary } from "react-error-boundary";
import { LANGY_PAIR_MS } from "~/features/langy/logic/langyPanelLayout";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useRouter } from "~/utils/compat/next-router";
import {
  type DrawerType,
  getComplexProps,
  getDrawerPropsVersion,
  getFlowCallbacks,
  subscribeDrawerProps,
} from "../hooks/useDrawer";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { useUpgradeModalStore } from "../stores/upgradeModalStore";
import { URL_QS_PARSE_OPTIONS } from "../utils/qsParseOptions";
import { drawers } from "./drawerRegistry";
import { DrawerExitRideProvider, DrawerOffsetProvider } from "./ui/drawer";

// Re-export for backward compatibility
export { useDrawer } from "../hooks/useDrawer";

/** Drawers that EXTERNAL users cannot open, mapped to their restriction resource. */
const restrictedDrawers: Partial<Record<DrawerType, string>> = {
  addDatasetRecord: "datasets",
};

type DrawerProps = {
  open: string;
} & Record<string, unknown>;

export function CurrentDrawer({ marginTop }: { marginTop?: number }) {
  const router = useRouter();
  // Re-render when complexProps changes without a URL change (e.g. reload
  // re-hydration of a comparison editor's context) so the getComplexProps()
  // read below picks the new value up. Only setComplexProps notifies this
  // subscription — setFlowCallbacks deliberately does not (see its own
  // comment) — but callers pair a setFlowCallbacks with a following
  // setComplexProps on the same re-hydration path, so the getFlowCallbacks()
  // read below still picks up fresh callbacks on the render that triggers.
  useSyncExternalStore(
    subscribeDrawerProps,
    getDrawerPropsVersion,
    getDrawerPropsVersion,
  );
  const { organizationRole } = useOrganizationTeamProject();
  const queryString = router.asPath.split("?")[1] ?? "";
  // qs.parse + the `drawer.*` slice is recomputed on every render otherwise,
  // handing the rendered drawer a fresh props object each time and cascading
  // a re-render through its subtree even when nothing drawer-relevant changed.
  const queryDrawer = useMemo<DrawerProps | undefined>(() => {
    const parsed = qs.parse(
      queryString.replaceAll("%2C", ","),
      URL_QS_PARSE_OPTIONS,
    );
    return parsed.drawer as DrawerProps | undefined;
  }, [queryString]);

  const drawerType = queryDrawer?.open as DrawerType | undefined;

  // Intercept restricted drawers for EXTERNAL users.
  // Instead of rendering the drawer, show the restriction modal
  // and clear the drawer from the URL. This protects ALL entry points:
  // direct clicks, command bar, deep links, and any future call sites.
  const restrictedResource = drawerType
    ? restrictedDrawers[drawerType]
    : undefined;
  const isRestricted =
    !!restrictedResource && organizationRole === OrganizationUserRole.EXTERNAL;

  useEffect(() => {
    if (!isRestricted || !restrictedResource) return;

    useUpgradeModalStore
      .getState()
      .openLiteMemberRestriction({ resource: restrictedResource });

    // Clear drawer from URL so it doesn't persist in browser history.
    // flushSync: see useDrawer.ts closeDrawer for why plain push can leave
    // this update uncommitted.
    void router.push(
      "?" +
        qs.stringify(
          Object.fromEntries(
            Object.entries(router.query).filter(
              ([key]) => !key.startsWith("drawer."),
            ),
          ),
        ),
      undefined,
      { shallow: true, flushSync: true },
    );
  }, [isRestricted]); // eslint-disable-line react-hooks/exhaustive-deps

  const CurrentDrawerComponent =
    drawerType && !isRestricted
      ? (drawers[drawerType] as React.FC<Record<string, unknown>>)
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
  const flowCallbacksForDrawer = drawerType
    ? getFlowCallbacks(drawerType)
    : undefined;

  const offsetValue = useMemo(() => ({ marginTop }), [marginTop]);

  // ── The companion ride's shared exit ──────────────────────────────────────
  // Closing a drawer here means UNMOUNTING it, which would skip any exit
  // motion. While the Langy panel is open the storyboard needs the pair to
  // leave together (spec: specs/langy/langy-panel-layout.feature), so the
  // just-closed drawer is HELD on stage for the beat: same component, same
  // props, pointer-inert, playing the shared pair-out via DrawerExitRideContext
  // (see DrawerContent). Held via a render-phase state update so the element
  // never unmounts between the URL change and the hold — the ride starts on
  // the same painted frame the close happens.
  const isLangyOpen = useLangyStore((s) => s.isOpen);
  const reduceMotion = useReducedMotion();
  type HeldDrawer = {
    Component: React.FC<Record<string, unknown>>;
    props: Record<string, unknown>;
  };
  const lastOpenRef = useRef<HeldDrawer | null>(null);
  const [heldForExit, setHeldForExit] = useState<HeldDrawer | null>(null);
  if (CurrentDrawerComponent) {
    lastOpenRef.current = {
      Component: CurrentDrawerComponent,
      props: {
        ...queryDrawer,
        ...complexProps,
        ...flowCallbacksForDrawer,
      },
    };
    if (heldForExit) setHeldForExit(null);
  } else if (
    lastOpenRef.current &&
    isLangyOpen &&
    !reduceMotion &&
    !heldForExit
  ) {
    setHeldForExit(lastOpenRef.current);
    lastOpenRef.current = null;
  } else if (!isLangyOpen && lastOpenRef.current) {
    lastOpenRef.current = null;
  }
  useEffect(() => {
    if (!heldForExit) return;
    const timer = setTimeout(() => setHeldForExit(null), LANGY_PAIR_MS + 60);
    return () => clearTimeout(timer);
  }, [heldForExit]);

  const exiting = !CurrentDrawerComponent ? heldForExit : null;
  const ActiveComponent = CurrentDrawerComponent ?? exiting?.Component;

  if (!ActiveComponent) return null;

  return (
    <DrawerOffsetProvider value={offsetValue}>
      <DrawerExitRideProvider value={!!exiting}>
        <ErrorBoundary
          resetKeys={[drawerType]}
          fallback={null}
          onError={() => {
            void router.push(
              "?" +
                qs.stringify(
                  Object.fromEntries(
                    Object.entries(router.query).filter(
                      ([key]) => !key.startsWith("drawer."),
                    ),
                  ),
                ),
              undefined,
              { shallow: true, flushSync: true },
            );
          }}
        >
          <Suspense fallback={<DrawerLoadingFallback />}>
            {exiting ? (
              <ActiveComponent {...exiting.props} />
            ) : (
              <ActiveComponent
                {...queryDrawer}
                {...complexProps}
                {...flowCallbacksForDrawer}
              />
            )}
          </Suspense>
        </ErrorBoundary>
      </DrawerExitRideProvider>
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
