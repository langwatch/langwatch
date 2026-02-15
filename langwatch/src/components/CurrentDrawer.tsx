import { useRouter } from "next/router";
import qs from "qs";
import { useEffect, useMemo } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  type DrawerType,
  getComplexProps,
  getFlowCallbacks,
} from "../hooks/useDrawer";
import { drawers } from "./drawerRegistry";
import { DrawerOffsetProvider } from "./ui/drawer";

// Re-export for backward compatibility
export { useDrawer } from "../hooks/useDrawer";

type DrawerProps = {
  open: string;
} & Record<string, unknown>;

export function CurrentDrawer({ marginTop }: { marginTop?: number }) {
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

  if (!CurrentDrawerComponent) return null;

  return (
    <DrawerOffsetProvider value={offsetValue}>
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
    </DrawerOffsetProvider>
  );
}
