import Router, { useRouter } from "next/router";
import qs from "qs";
import {
  type DrawerCallbacks,
  type DrawerProps,
  type DrawerType,
  drawers,
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
// Main Hook
// ============================================================================

/**
 * Hook to manage drawer state via URL query params.
 * Includes navigation stack for automatic back button handling.
 */
export const useDrawer = () => {
  const router = useRouter();

  const currentDrawer = router.query["drawer.open"] as DrawerType | undefined;

  /**
   * Internal function to update URL without modifying the stack.
   * Used by goBack to restore previous drawer state.
   */
  const updateDrawerUrl = (
    drawer: DrawerType,
    props?: Record<string, unknown>,
    options: { replace?: boolean } = {},
  ) => {
    // Separate serializable props (for URL) from complex props (kept in memory)
    const serializableProps: Record<string, unknown> = {};
    const nonSerializableProps: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(props ?? {})) {
      if (typeof value === "function" || typeof value === "object") {
        // Functions and objects go to complexProps (not URL)
        nonSerializableProps[key] = value;
      } else {
        // Primitives (string, number, boolean, null, undefined) go to URL
        serializableProps[key] = value;
      }
    }

    complexProps = nonSerializableProps;

    void router[options.replace ? "replace" : "push"](
      "?" +
        qs.stringify(
          {
            ...Object.fromEntries(
              Object.entries(router.query).filter(
                ([key, value]) =>
                  !key.startsWith("drawer.") &&
                  typeof value !== "function" &&
                  typeof value !== "object",
              ),
            ),
            drawer: {
              open: drawer,
              ...serializableProps, // Only serializable props go to URL
            },
          },
          {
            allowDots: true,
            arrayFormat: "comma",
            // @ts-ignore - allowEmptyArrays exists
            allowEmptyArrays: true,
          },
        ),
      undefined,
      { shallow: true },
    );
  };

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
  const openDrawer = <T extends DrawerType>(
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

    // If the same drawer is already open, just update the URL params without modifying the stack
    if (currentDrawer === drawer) {
      updateDrawerUrl(drawer, allParams, { replace: true });
      return;
    }

    // Manage drawer stack for navigation history
    if (resetStack || !currentDrawer) {
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
      if (drawerStack.length === 0 && currentDrawer) {
        drawerStack.push({ drawer: currentDrawer, params: {} });
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
  };

  /**
   * Close the current drawer.
   * Also clears the drawer stack and flow callbacks.
   */
  const closeDrawer = () => {
    // Clear the entire stack and flow callbacks
    drawerStack = [];
    clearFlowCallbacks();
    complexProps = {};

    void router.push(
      "?" +
        qs.stringify(
          Object.fromEntries(
            Object.entries(router.query).filter(
              ([key]) => !key.startsWith("drawer.") && key !== "span",
            ),
          ),
          {
            allowDots: true,
            arrayFormat: "comma",
            // @ts-ignore - allowEmptyArrays exists
            allowEmptyArrays: true,
          },
        ),
      undefined,
      { shallow: true },
    );
  };

  /**
   * Go back to the previous drawer in the stack.
   * If at the root (stack length <= 1), closes the drawer entirely.
   */
  const goBack = () => {
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
  };

  /**
   * Check if a specific drawer is currently open (the active/visible one).
   */
  const drawerOpen = (drawer: DrawerType) => {
    return router.query["drawer.open"] === drawer;
  };

  /**
   * Check if a specific drawer is anywhere in the navigation stack.
   * Use this to keep a drawer mounted (but possibly behind others) while navigating.
   *
   * @example
   * // Keep ScenarioFormDrawer mounted while navigating to child drawers
   * <ScenarioFormDrawer open={drawerInStack("scenarioEditor")} />
   */
  const drawerInStack = (drawer: DrawerType) => {
    return drawerStack.some((entry) => entry.drawer === drawer);
  };

  /**
   * Whether there's a previous drawer to go back to.
   * Use this to conditionally show the back button.
   */
  const canGoBack = drawerStack.length > 1;

  return {
    openDrawer,
    closeDrawer,
    drawerOpen,
    drawerInStack,
    goBack,
    canGoBack,
    currentDrawer,
    setFlowCallbacks,
    getFlowCallbacks,
  };
};

// Re-export types for convenience
export type {
  DrawerCallbacks,
  DrawerProps,
  DrawerType,
} from "../components/drawerRegistry";
