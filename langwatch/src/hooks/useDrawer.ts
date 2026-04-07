import Router, { useRouter } from "next/router";
import qs from "qs";
import { useCallback, useMemo } from "react";
import {
  type DrawerCallbacks,
  type DrawerProps,
  type DrawerType,
} from "../components/drawerRegistry";
import { createLogger } from "../utils/logger";

const logger = createLogger("useDrawer");

// ============================================================================
// Complex Props (per-drawer, replaced on each navigation)
// ============================================================================

/**
 * Complex props for the currently active drawer.
 * These are non-serializable props (functions, objects) that can't go in the URL.
 * Replaced on each openDrawer call.
 */
let complexProps: Record<string, unknown> = {};

export const getComplexProps = () => complexProps;

// ============================================================================
// Flow Callbacks (persist across drawer navigation within a flow)
// ============================================================================

/**
 * Flow callbacks registry - persists across drawer navigation.
 * Use this for callbacks that need to survive navigation between drawers
 * (e.g., onSelectPrompt callback that should work in promptList even when
 * opened from targetTypeSelector).
 *
 * Cleared automatically when closeDrawer() is called.
 */
let flowCallbacks: Record<string, Record<string, unknown>> = {};

/**
 * Set flow callbacks for a specific drawer type.
 * These persist across drawer navigation until closeDrawer() is called.
 *
 * @example
 * // In EvaluationsV3Table:
 * setFlowCallbacks("promptList", { onSelect: handleSelectPrompt });
 * setFlowCallbacks("agentList", { onSelect: handleSelectAgent });
 * openDrawer("targetTypeSelector");
 *
 * // Later, in PromptListDrawer, callbacks are available via getFlowCallbacks
 */
export const setFlowCallbacks = <T extends DrawerType>(
  drawer: T,
  callbacks: DrawerCallbacks<T>,
) => {
  flowCallbacks[drawer] = callbacks as Record<string, unknown>;
};

/**
 * Get flow callbacks for a specific drawer type.
 * Returns undefined if no callbacks are registered for this drawer.
 */
export const getFlowCallbacks = <T extends DrawerType>(
  drawer: T,
): DrawerCallbacks<T> | undefined => {
  return flowCallbacks[drawer] as DrawerCallbacks<T> | undefined;
};

/**
 * Clear all flow callbacks. Called automatically by closeDrawer().
 */
export const clearFlowCallbacks = () => {
  flowCallbacks = {};
};

/**
 * Get all flow callbacks (for debugging/testing).
 */
export const getAllFlowCallbacks = () => flowCallbacks;

// ============================================================================
// Drawer Stack (navigation history)
// ============================================================================

type DrawerStackEntry = {
  drawer: DrawerType;
  params: Record<string, unknown>;
};

/**
 * Module-level drawer stack for tracking navigation history.
 * Enables automatic back button visibility based on navigation depth.
 */
let drawerStack: DrawerStackEntry[] = [];

export const getDrawerStack = () => drawerStack;
export const clearDrawerStack = () => {
  drawerStack = [];
};

/**
 * Navigate to a drawer from module-level code (e.g., flow callbacks).
 * This is useful when the callback is captured from a component that may not be mounted.
 *
 * @param drawer - The drawer to navigate to
 * @param options - Navigation options
 */
export const navigateToDrawer = (
  drawer: DrawerType,
  options: { resetStack?: boolean } = {},
) => {
  // Reset stack if requested
  if (options.resetStack) {
    drawerStack = [{ drawer, params: {} }];
  } else {
    drawerStack.push({ drawer, params: {} });
  }

  // Clear complex props since we're navigating fresh
  complexProps = {};

  // Build the URL and navigate
  const currentQuery = Router.query;
  const newQuery = {
    ...Object.fromEntries(
      Object.entries(currentQuery).filter(
        ([key]) => !key.startsWith("drawer."),
      ),
    ),
    "drawer.open": drawer,
  };

  void Router.push(
    "?" + qs.stringify(newQuery, { allowDots: true, arrayFormat: "comma" }),
    undefined,
    { shallow: true },
  );
};

// ============================================================================
// URL Params
// ============================================================================

/**
 * Get simple (serializable) drawer params from URL query.
 * Call this inside a component to get params like `category`, `evaluatorType`, etc.
 */
export const useDrawerParams = () => {
  const router = useRouter();
  const params: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(router.query)) {
    if (key.startsWith("drawer.") && key !== "drawer.open") {
      const paramName = key.replace("drawer.", "");
      params[paramName] = typeof value === "string" ? value : undefined;
    }
  }

  return params;
};

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Determines whether a value can be safely serialized into a URL query string.
 *
 * Primitives (string, number, boolean, null, undefined) are always serializable.
 * Arrays of primitives are serializable via qs's `arrayFormat: "comma"`.
 *
 * Note: single-element arrays round-trip as plain strings through qs
 * (e.g., `["a"]` → `"a"`). Consumers must handle both `T` and `T[]`.
 *
 * Functions, plain objects, Dates, and arrays containing objects are NOT serializable
 * and go to `complexProps` (module-level ephemeral store).
 */
function isUrlSerializable(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "function") return false;
  if (typeof value !== "object") return true; // string, number, boolean

  // Arrays of primitives can be comma-serialized by qs
  if (Array.isArray(value)) {
    return value.every(
      (item) =>
        item === null ||
        (typeof item !== "object" && typeof item !== "function"),
    );
  }

  return false; // Plain objects, Dates, etc.
}

// ============================================================================
// Main Hook
// ============================================================================

/**
 * Hook to manage drawer state via URL query params.
 * Includes navigation stack for automatic back button handling.
 *
 * All returned functions are memoized with useCallback to prevent
 * unnecessary re-renders in consuming components.
 */
export const useDrawer = () => {
  const router = useRouter();

  const currentDrawer = router.query["drawer.open"] as DrawerType | undefined;

  /**
   * Internal function to update URL without modifying the stack.
   * Used by goBack to restore previous drawer state.
   */
  const updateDrawerUrl = useCallback(
    (
      drawer: DrawerType,
      props?: Record<string, unknown>,
      options: { replace?: boolean } = {},
    ) => {
      // Separate serializable props (for URL) from complex props (kept in memory)
      const serializableProps: Record<string, unknown> = {};
      const nonSerializableProps: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(props ?? {})) {
        if (isUrlSerializable(value)) {
          serializableProps[key] = value;
        } else {
          nonSerializableProps[key] = value;
        }
      }

      complexProps = nonSerializableProps;

      // Build query from current non-drawer, non-path query params only.
      // Path params (project, scenarioSetId, etc.) are part of the URL path
      // and must NOT be serialized into the query string.
      const pathParamKeys = new Set(
        (router.pathname.match(/\[(\w+)\]/g) ?? []).map((m) => m.slice(1, -1)),
      );
      const currentQueryOnly = Object.fromEntries(
        Object.entries(router.query).filter(
          ([key, value]) =>
            !key.startsWith("drawer.") &&
            !pathParamKeys.has(key) &&
            typeof value !== "function" &&
            typeof value !== "object",
        ),
      );

      const newQuery = qs.stringify(
        {
          ...currentQueryOnly,
          drawer: {
            open: drawer,
            ...serializableProps,
          },
        },
        {
          allowDots: true,
          arrayFormat: "comma",
          allowEmptyArrays: true,
        },
      );

      // Preserve the current URL path (from asPath) and append the new query
      const currentPath = router.asPath.split("?")[0]!;
      void router[options.replace ? "replace" : "push"](
        `${currentPath}?${newQuery}`,
        undefined,
        { shallow: true },
      );
    },
    [router],
  );

  /**
   * Open a drawer with type-safe props.
   *
   * @param drawer - The drawer type to open
   * @param props - Props for the drawer component (type-checked against drawer props).
   *                Can also include additional URL params via the `urlParams` property.
   * @param options - Options like { replace: true } to replace URL instead of push,
   *                   or { resetStack: true } to reset navigation stack (no back button)
   *
   * @example
   * // Type-safe drawer props
   * openDrawer("promptEditor", { promptId: "abc" });
   *
   * // With additional URL params for context
   * openDrawer("promptEditor", { promptId: "abc", urlParams: { targetId: "123" } });
   *
   * // Reset stack to prevent back button (useful when switching contexts)
   * openDrawer("promptEditor", { promptId: "abc" }, { resetStack: true });
   */
  const openDrawer = useCallback(
    <T extends DrawerType>(
      drawer: T,
      props?: Partial<DrawerProps<T>> & { urlParams?: Record<string, string> },
      {
        replace,
        resetStack,
        replaceCurrentInStack,
      }: {
        replace?: boolean;
        resetStack?: boolean;
        replaceCurrentInStack?: boolean;
      } = {},
    ) => {
      // Extract urlParams and merge with props
      const { urlParams, ...drawerProps } = props ?? {};
      const allParams = { ...drawerProps, ...urlParams } as Record<
        string,
        unknown
      >;

      // Read currentDrawer from router.query directly to get latest value
      const currentDrawerNow = router.query["drawer.open"] as
        | DrawerType
        | undefined;

      // If the same drawer is already open, just update the URL params without modifying the stack
      if (currentDrawerNow === drawer) {
        updateDrawerUrl(drawer, allParams, { replace: true });
        return;
      }

      // Manage drawer stack for navigation history
      if (resetStack || !currentDrawerNow) {
        // Reset stack - fresh start with no back navigation
        drawerStack = [{ drawer, params: allParams }];
      } else if (replaceCurrentInStack && drawerStack.length > 0) {
        // Replace the current entry in the stack (useful for flow callbacks)
        // This makes "back" skip the replaced drawer
        drawerStack.pop();
        drawerStack.push({ drawer, params: allParams });
      } else {
        // A drawer is already open - navigating forward, push to stack
        // If stack is empty but currentDrawer exists (e.g., opened via direct URL),
        // add currentDrawer to stack first so we can go back to it
        if (drawerStack.length === 0 && currentDrawerNow) {
          drawerStack.push({ drawer: currentDrawerNow, params: {} });
        }

        // Snapshot current URL params for the top-of-stack drawer so goBack
        // restores the full state (e.g. selectedTab set after initial open)
        const topEntry = drawerStack[drawerStack.length - 1];
        if (topEntry && topEntry.drawer === currentDrawerNow) {
          const currentUrlParams: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(router.query)) {
            if (key.startsWith("drawer.") && key !== "drawer.open") {
              currentUrlParams[key.replace("drawer.", "")] = value;
            }
          }
          topEntry.params = currentUrlParams;
        }

        drawerStack.push({ drawer, params: allParams });
      }

      const badKeys = Object.entries(allParams)
        .filter(([_, v]) => typeof v === "function" || typeof v === "symbol")
        .map(([k]) => k);
      if (badKeys.length > 0) {
        logger.warn(
          `Non-serializable props passed to drawer "${drawer}": ${badKeys.join(
            ", ",
          )}. ` +
            `Consider using setFlowCallbacks() for callbacks that need to persist across navigation.`,
        );
      }

      updateDrawerUrl(drawer, allParams, { replace });
    },
    [router.query, updateDrawerUrl],
  );

  /**
   * Close the current drawer.
   * Also clears the drawer stack and flow callbacks.
   */
  const closeDrawer = useCallback(() => {
    // Clear the entire stack and flow callbacks
    drawerStack = [];
    clearFlowCallbacks();
    complexProps = {};

    // Filter out drawer params and path params, keep only actual query params
    const pathParamKeys = new Set(
      (router.pathname.match(/\[(\w+)\]/g) ?? []).map((m) => m.slice(1, -1)),
    );
    const cleanQuery = Object.fromEntries(
      Object.entries(router.query).filter(
        ([key]) =>
          !key.startsWith("drawer.") &&
          key !== "span" &&
          !pathParamKeys.has(key),
      ),
    );
    const queryString = qs.stringify(cleanQuery, {
      allowDots: true,
      arrayFormat: "comma",
      // @ts-ignore - allowEmptyArrays exists
      allowEmptyArrays: true,
    });

    const currentPath = router.asPath.split("?")[0]!;
    void router.push(
      queryString ? `${currentPath}?${queryString}` : currentPath,
      undefined,
      { shallow: true },
    );
  }, [router]);

  /**
   * Go back to the previous drawer in the stack.
   * If at the root (stack length <= 1), closes the drawer entirely.
   */
  const goBack = useCallback(() => {
    if (drawerStack.length <= 1) {
      closeDrawer();
      return;
    }

    // Remove current drawer from stack
    drawerStack.pop();

    // Get the previous drawer
    const previous = drawerStack[drawerStack.length - 1];
    if (!previous) {
      closeDrawer();
      return;
    }

    // Restore previous drawer (use replace to avoid browser history pollution)
    updateDrawerUrl(previous.drawer, previous.params, { replace: true });
  }, [closeDrawer, updateDrawerUrl]);

  /**
   * Check if a specific drawer is currently open.
   */
  const drawerOpen = useCallback(
    (drawer: DrawerType) => {
      return router.query["drawer.open"] === drawer;
    },
    [router.query],
  );

  /**
   * Whether there's a previous drawer to go back to.
   * Use this to conditionally show the back button.
   */
  const canGoBack = drawerStack.length > 1;

  return useMemo(
    () => ({
      openDrawer,
      closeDrawer,
      drawerOpen,
      goBack,
      canGoBack,
      currentDrawer,
      setFlowCallbacks,
      getFlowCallbacks,
    }),
    [openDrawer, closeDrawer, drawerOpen, goBack, canGoBack, currentDrawer],
  );
};

// Re-export types for convenience
export type {
  DrawerCallbacks,
  DrawerProps,
  DrawerType,
} from "../components/drawerRegistry";
