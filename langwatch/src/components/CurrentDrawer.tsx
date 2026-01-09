import { useRouter } from "next/router";
import qs from "qs";
import { useEffect } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  getComplexProps,
  getFlowCallbacks,
  type DrawerType,
} from "../hooks/useDrawer";
import { drawers } from "./drawerRegistry";

// Re-export for backward compatibility
export { useDrawer } from "../hooks/useDrawer";

/** Track which drawers are currently mounted via CurrentDrawer */
const mountedByCurrentDrawer = new Set<string>();

/**
 * Check if a drawer type is already being rendered by CurrentDrawer.
 * Call this in dev mode from drawer components to detect duplicate rendering.
 */
export function isDrawerMountedGlobally(drawerType: string): boolean {
  return mountedByCurrentDrawer.has(drawerType);
}

type DrawerProps = {
  open: string;
} & Record<string, unknown>;

export function CurrentDrawer() {
  const router = useRouter();
  const queryString = router.asPath.split("?")[1] ?? "";
  const queryParams = qs.parse(queryString.replaceAll("%2C", ","), {
    allowDots: true,
    comma: true,
    allowEmptyArrays: true,
  });
  const queryDrawer = queryParams.drawer as DrawerProps | undefined;

  const drawerType = queryDrawer?.open as DrawerType | undefined;
  const CurrentDrawerComponent = drawerType
    ? (drawers[drawerType] as React.FC<Record<string, unknown>>)
    : undefined;

  // Track mounted drawer for duplicate detection
  useEffect(() => {
    if (!drawerType) return;
    mountedByCurrentDrawer.add(drawerType);
    return () => {
      mountedByCurrentDrawer.delete(drawerType);
    };
  }, [drawerType]);

  // Get props from multiple sources:
  // 1. URL query params (serializable props)
  // 2. complexProps (per-drawer non-serializable props)
  // 3. flowCallbacks (persistent callbacks across navigation)
  const complexProps = getComplexProps();
  const flowCallbacksForDrawer = drawerType
    ? getFlowCallbacks(drawerType)
    : undefined;

  return CurrentDrawerComponent ? (
    <ErrorBoundary
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
          { shallow: true },
        );
      }}
    >
      <CurrentDrawerComponent
        {...queryDrawer}
        {...complexProps}
        {...flowCallbacksForDrawer}
      />
    </ErrorBoundary>
  ) : null;
}
