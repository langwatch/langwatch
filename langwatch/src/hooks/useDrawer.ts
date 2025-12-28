import { useRouter } from "next/router";
import qs from "qs";
import { createLogger } from "../utils/logger";

const logger = createLogger("useDrawer");

/**
 * Drawer type registry. Add new drawer types here.
 */
export type DrawerType =
  | "traceDetails"
  | "batchEvaluation"
  | "trigger"
  | "addOrEditAnnotationScore"
  | "addAnnotationQueue"
  | "addDatasetRecord"
  | "llmModelCost"
  | "uploadCSV"
  | "addOrEditDataset"
  | "editTriggerFilter"
  | "seriesFilters"
  | "selectDataset"
  // Runner type selector (Prompt vs Agent)
  | "runnerTypeSelector"
  // Prompt drawers
  | "promptList"
  | "promptEditor"
  // Agent drawers (code or workflow only)
  | "agentList"
  | "agentTypeSelector"
  | "agentCodeEditor"
  | "workflowSelector"
  // Evaluator drawers
  | "evaluatorList"
  | "evaluatorCategorySelector"
  | "evaluatorTypeSelector"
  | "evaluatorEditor"
  | "workflowSelectorForEvaluator";

/** Generic callback type for drawer props - callers must narrow before use */
type DrawerCallback = (...args: unknown[]) => void;

// workaround to pass complexProps to drawers
let complexProps = {} as Record<string, DrawerCallback>;

export const getComplexProps = () => {
  return complexProps;
};

/**
 * Drawer stack entry for navigation history.
 */
type DrawerStackEntry = {
  drawer: DrawerType;
  params: Record<string, unknown>;
};

/**
 * Module-level drawer stack for tracking navigation history.
 * This enables automatic back button visibility based on navigation depth.
 */
let drawerStack: DrawerStackEntry[] = [];

/**
 * Get the current drawer stack (for testing/debugging).
 */
export const getDrawerStack = () => drawerStack;

/**
 * Clear the drawer stack (useful for testing).
 */
export const clearDrawerStack = () => {
  drawerStack = [];
};

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
    complexProps = Object.fromEntries(
      Object.entries(props ?? {}).filter(
        ([_key, value]) =>
          typeof value === "function" || typeof value === "object",
      ),
    ) as Record<string, DrawerCallback>;

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
              ...props,
            },
          },
          {
            allowDots: true,
            arrayFormat: "comma",
            // @ts-ignore of course it exists
            allowEmptyArrays: true,
          },
        ),
      undefined,
      { shallow: true },
    );
  };

  const openDrawer = <T extends DrawerType>(
    drawer: T,
    props?: Record<string, unknown>,
    { replace }: { replace?: boolean } = {},
  ) => {
    // Manage drawer stack for navigation history
    if (currentDrawer) {
      // A drawer is already open - navigating forward, push to stack
      drawerStack.push({ drawer, params: props ?? {} });
    } else {
      // No drawer open - fresh start, reset stack
      drawerStack = [{ drawer, params: props ?? {} }];
    }

    const badKeys = Object.entries(props ?? {})
      .filter(([_, v]) => typeof v === "function" || typeof v === "symbol")
      .map(([k]) => k);
    if (badKeys.length > 0) {
      logger.warn(
        `Non-serializable props passed to drawer "${drawer}": ${badKeys.join(", ")}`,
      );
    }

    updateDrawerUrl(drawer, props, { replace });
  };

  const closeDrawer = () => {
    // Clear the entire stack when closing
    drawerStack = [];

    void router.push(
      "?" +
        qs.stringify(
          Object.fromEntries(
            Object.entries(router.query).filter(
              ([key]) => !key.startsWith("drawer.") && key !== "span", // remove span key as well left by trace details
            ),
          ),
          {
            allowDots: true,
            arrayFormat: "comma",
            // @ts-ignore of course it exists
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

  const drawerOpen = (drawer: DrawerType) => {
    return router.query["drawer.open"] === drawer;
  };

  /**
   * Whether there's a previous drawer to go back to.
   * Use this to conditionally show the back button.
   */
  const canGoBack = drawerStack.length > 1;

  return { openDrawer, closeDrawer, drawerOpen, goBack, canGoBack };
};
