/**
 * URL-routed singleton drawers: the address vocabulary and the navigation stack.
 *
 * Moved out of `platform/app/src/hooks/useDrawer.ts` whole. Everything about
 * how a drawer is addressed — `?drawer.open=<name>` plus one `drawer.<key>` per
 * serialisable prop, the module-scope stores for what a URL cannot carry, and
 * the stack that makes the back button mean something — is here and unchanged.
 *
 * TWO SEAMS ARE REDESIGNED, both because the platform import behind them has no
 * package export: the router (see `drawer-router.ts`) and the trace-drawer
 * funnel, which named two drawers by hand inside framework code and is now an
 * installable rewrite the host registers.
 */

import { createLogger } from "@langwatch/observability";
import qs from "qs";
import { useCallback, useMemo } from "react";

import { URL_QS_PARSE_OPTIONS } from "../model/qs-parse-options";
import type {
  DrawerCallbacksOf,
  DrawerPropsOf,
  DrawerTypeOf,
  UiDrawerRegistry,
} from "../model/drawer-registry";
import { drawerRouterRef, useDrawerRouter } from "./drawer-router";

const logger = createLogger("useDrawer");

/** A drawer name for a caller that did not name a registry. */
export type DrawerType = string;

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
// Reactive subscription for the non-serializable drawer props
// ============================================================================
//
// CurrentDrawer reads complexProps + flowCallbacks with plain getters during
// render, so it only picks up changes when it re-renders — normally driven by
// a URL change. A change that does NOT touch the URL (e.g. a page reload
// re-hydrating a comparison editor's targets/dataset-columns from the workbench
// store) would otherwise never reach the open drawer. This version counter +
// listener set drives a useSyncExternalStore subscription in CurrentDrawer.
let drawerPropsVersion = 0;
const drawerPropsListeners = new Set<() => void>();
const notifyDrawerPropsChanged = () => {
  drawerPropsVersion += 1;
  for (const listener of drawerPropsListeners) listener();
};
export const subscribeDrawerProps = (listener: () => void): (() => void) => {
  drawerPropsListeners.add(listener);
  return () => {
    drawerPropsListeners.delete(listener);
  };
};
export const getDrawerPropsVersion = (): number => drawerPropsVersion;

/**
 * Merge non-serializable props into the CURRENT drawer's complexProps and
 * notify subscribers so CurrentDrawer re-renders and re-reads them. Use to
 * (re)attach in-memory context to an already-open drawer WITHOUT a URL change —
 * e.g. rebuilding a comparison editor's context after a reload wiped the
 * ephemeral complexProps. `openDrawer` still fully REPLACES complexProps on a
 * fresh open; this only augments what is already attached.
 */
export const setComplexProps = (props: Record<string, unknown>): void => {
  complexProps = { ...complexProps, ...props };
  notifyDrawerPropsChanged();
};

// ============================================================================
// Flow Callbacks (persist across drawer navigation within a flow)
// ============================================================================

/**
 * Flow callbacks registry - persists across drawer navigation.
 * Use this for callbacks that need to survive navigation between drawers
 * (e.g., onSelectPrompt callback that should work in promptList even when
 * opened from targetTypeSelector).
 *
 * Cleared automatically when closeDrawer() is called, except for the entries
 * registered with `keepOnClose`.
 */
let flowCallbacks: Record<string, Record<string, unknown>> = {};

/**
 * The drawers whose callbacks belong to a mounted component rather than to one
 * drawer flow.
 *
 * A page-level component that registers a callback for its own drawer holds it
 * for as long as it is mounted, and takes it back itself on unmount. Closing
 * an unrelated drawer must not take it away: the component would never know,
 * because nothing tells it, and the next time the drawer called that callback
 * there would be nothing there.
 */
const keptOnClose = new Set<string>();

/**
 * Set flow callbacks for a specific drawer type.
 * These persist across drawer navigation until closeDrawer() is called.
 *
 * @example
 * setFlowCallbacks("promptList", { onSelect: handleSelectPrompt });
 * setFlowCallbacks("agentList", { onSelect: handleSelectAgent });
 * openDrawer("targetTypeSelector");
 */
export const setFlowCallbacks = (
  drawer: DrawerType,
  // oxlint-disable-next-line no-explicit-any
  callbacks: Record<string, any>,
  options?: {
    /**
     * True when a mounted component owns the registration, so that closing a
     * drawer leaves it alone. The owner takes it back on unmount, by
     * registering an empty set.
     */
    keepOnClose?: boolean;
  },
) => {
  // Deliberately does NOT notify. Callers register callbacks BEFORE opening a
  // drawer (the URL change renders it) or, on the re-hydration path, right
  // before a setComplexProps that does notify — and CurrentDrawer re-reads both
  // maps on any re-render, so a notify here is redundant. It is also expensive:
  // this is called from ~65 sites across the app, and notifying would re-render
  // CurrentDrawer — and cascade through the open drawer's subtree — every time
  // any unrelated flow registered a callback.
  flowCallbacks[drawer] = callbacks as Record<string, unknown>;
  if (options?.keepOnClose) keptOnClose.add(drawer);
  else keptOnClose.delete(drawer);
};

/**
 * Get flow callbacks for a specific drawer type.
 * Returns undefined if no callbacks are registered for this drawer.
 */
// oxlint-disable-next-line no-explicit-any
export const getFlowCallbacks = (drawer: DrawerType): Record<string, any> | undefined => {
  return flowCallbacks[drawer];
};

/**
 * Clear the flow callbacks of the drawer flows. Called automatically by
 * closeDrawer().
 *
 * What a mounted component registered with `keepOnClose` stays: it belongs to
 * that component, which is still there and still expects to be called.
 */
export const clearFlowCallbacks = () => {
  const kept: Record<string, Record<string, unknown>> = {};
  for (const drawer of keptOnClose) {
    const callbacks = flowCallbacks[drawer];
    if (callbacks) kept[drawer] = callbacks;
  }
  flowCallbacks = kept;
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
 * The drawer currently on top of the stack, or `undefined` when nothing is
 * stacked. A drawer that mounts from its own store rather than from the URL
 * (the Trace Explorer) checks this before asking for a back navigation: the
 * stack is module-global and outlives any single drawer, so going back on a
 * stack that no longer describes the open drawer walks into an unrelated one.
 */
export const getTopDrawer = (): DrawerType | undefined =>
  drawerStack[drawerStack.length - 1]?.drawer;

// ============================================================================
// The open rewrite the host installs
// ============================================================================

/**
 * A rule that redirects one drawer-open request to another.
 *
 * `platform/app` hard-coded the Trace Explorer funnel inside this navigator: a
 * `traceDetails` open carrying a trace id became a `traceV2Details` open, so
 * every "view trace" call site landed on one drawer however it spelled the
 * request. That rule is a FEATURE's, not the framework's, so the framework
 * takes it as an install and the application registers it beside the registry
 * that names those two drawers.
 */
export type DrawerOpenRewrite = (
  drawer: DrawerType,
  props: Record<string, unknown> | undefined,
) => { drawer: DrawerType; props: Record<string, unknown> | undefined };

const passThroughRewrite: DrawerOpenRewrite = (drawer, props) => ({ drawer, props });

let openRewrite: DrawerOpenRewrite = passThroughRewrite;

export const installDrawerOpenRewrite = (rewrite: DrawerOpenRewrite): void => {
  openRewrite = rewrite;
};

export const clearDrawerOpenRewrite = (): void => {
  openRewrite = passThroughRewrite;
};

/**
 * The drawer the browser URL has open right now. A router reading is a render
 * snapshot and can lag a navigation that already landed, so a decision about
 * what the reader is looking at *at this moment* reads the address bar.
 */
const openDrawerInLocation = (): DrawerType | undefined => {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("drawer.open") ?? undefined;
};

/**
 * Navigate to a drawer from module-level code (e.g., flow callbacks).
 * This is useful when the callback is captured from a component that may not be
 * mounted.
 */
export const navigateToDrawer = (drawer: DrawerType, options: { resetStack?: boolean } = {}) => {
  // Reset stack if requested
  if (options.resetStack) {
    drawerStack = [{ drawer, params: {} }];
  } else {
    drawerStack.push({ drawer, params: {} });
  }

  // Clear complex props since we're navigating fresh
  complexProps = {};

  const router = drawerRouterRef.current;
  if (!router) {
    logger.warn(
      `navigateToDrawer("${drawer}") ran with no mounted drawer navigator; the address was not written.`,
    );
    return;
  }

  const newQuery = {
    ...Object.fromEntries(
      Object.entries(router.query).filter(([key]) => !key.startsWith("drawer.")),
    ),
    "drawer.open": drawer,
  };

  router.push("?" + qs.stringify(newQuery, { allowDots: true, arrayFormat: "comma" }));
};

// ============================================================================
// URL Params
// ============================================================================

/**
 * Update individual `drawer.<key>` params in the URL without touching the
 * rest of the query or replacing the open drawer. Returns a setter that
 * accepts a partial update map; pass `undefined` to remove a key.
 *
 * Use `push: true` (default) so each call adds a browser history entry —
 * back / forward then walks through the user's tab navigation. Pass
 * `push: false` for silent updates (e.g. mirroring local state on mount).
 */
export const useUpdateDrawerParams = () => {
  const router = useDrawerRouter();
  return useCallback(
    (updates: Record<string, string | undefined>, options: { push?: boolean } = {}) => {
      const push = options.push ?? true;
      const { path, queryString, hash } = splitAsPath(router.asPath);
      const parsed = qs.parse(queryString, URL_QS_PARSE_OPTIONS) as Record<string, unknown>;
      // `parsed.drawer` is whatever qs parsed out of the URL — for a malformed
      // query like `?drawer=foo` it's a string, not the object we mutate below.
      // Guard the shape so the mutation loop can't throw at runtime.
      const drawer =
        parsed.drawer && typeof parsed.drawer === "object" && !Array.isArray(parsed.drawer)
          ? (parsed.drawer as Record<string, unknown>)
          : {};
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) delete drawer[key];
        else drawer[key] = value;
      }
      parsed.drawer = drawer;
      const newQs = qs.stringify(parsed, {
        allowDots: true,
        arrayFormat: "comma",
        allowEmptyArrays: true,
      });
      router.push(buildUrl(path, newQs, hash), { replace: !push });
    },
    [router],
  );
};

/**
 * Get simple (serializable) drawer params from URL query.
 * Call this inside a component to get params like `category`, `evaluatorType`, etc.
 */
export const useDrawerParams = () => {
  const router = useDrawerRouter();
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
 * Split an address into (path, query, hash). Handles both `?q#h` and `#h?q`
 * orderings — important for lens routes like `/traces#conversations` where
 * naive concatenation can leave drawer query params parked after the hash,
 * which `location.search` cannot see.
 */
function splitAsPath(asPath: string): {
  path: string;
  queryString: string;
  hash: string;
} {
  const queryIdx = asPath.indexOf("?");
  const hashIdx = asPath.indexOf("#");
  let pathEnd = asPath.length;
  if (queryIdx !== -1) pathEnd = Math.min(pathEnd, queryIdx);
  if (hashIdx !== -1) pathEnd = Math.min(pathEnd, hashIdx);
  const path = asPath.slice(0, pathEnd);
  const rest = asPath.slice(pathEnd);
  if (rest.startsWith("?")) {
    const h = rest.indexOf("#");
    if (h === -1) return { path, queryString: rest.slice(1), hash: "" };
    return { path, queryString: rest.slice(1, h), hash: rest.slice(h + 1) };
  }
  if (rest.startsWith("#")) {
    const q = rest.indexOf("?");
    if (q === -1) return { path, queryString: "", hash: rest.slice(1) };
    return { path, queryString: rest.slice(q + 1), hash: rest.slice(1, q) };
  }
  return { path, queryString: "", hash: "" };
}

function buildUrl(path: string, queryString: string, hash: string): string {
  let url = path;
  if (queryString) url += `?${queryString}`;
  if (hash) url += `#${hash}`;
  return url;
}

/**
 * Determines whether a value can be safely serialized into a URL query string.
 *
 * Primitives (string, number, boolean, null, undefined) are always serializable.
 * Arrays of primitives are serializable via qs's `arrayFormat: "comma"`.
 *
 * Note: single-element arrays round-trip as plain strings through qs
 * (e.g., `["a"]` → `"a"`). Consumers must handle both `T` and `T[]`.
 *
 * Functions, plain objects, Dates, and arrays containing objects are NOT
 * serializable and go to `complexProps` (module-level ephemeral store).
 */
function isUrlSerializable(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "function") return false;
  if (typeof value !== "object") return true; // string, number, boolean

  // Arrays of primitives can be comma-serialized by qs
  if (Array.isArray(value)) {
    return value.every(
      (item) => item === null || (typeof item !== "object" && typeof item !== "function"),
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
 * GENERIC OVER THE REGISTRY, which is what the composed registry cost and
 * bought. `platform/app` derived `DrawerType` from `keyof typeof drawers`, a
 * union only one module could produce. Naming the application's registry —
 * `useDrawer<typeof installedUiDrawers>()` — gets the same per-drawer prop
 * checking at the call site; a caller inside a feature package, which may not
 * name the application's registry, gets strings.
 *
 * All returned functions are memoized with useCallback to prevent
 * unnecessary re-renders in consuming components.
 */
export const useDrawer = <R extends UiDrawerRegistry = UiDrawerRegistry>() => {
  const router = useDrawerRouter();

  const currentDrawer = router.query["drawer.open"] as DrawerTypeOf<R> | undefined;

  /**
   * Internal function to update URL without modifying the stack.
   * Used by goBack to restore previous drawer state.
   */
  const updateDrawerUrl = useCallback(
    (drawer: DrawerType, props?: Record<string, unknown>, options: { replace?: boolean } = {}) => {
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

      // Build query from the actual browser URL, not a params snapshot: this
      // preserves filter params the address carries and the snapshot does not.
      const { path, queryString, hash } = splitAsPath(router.asPath);
      const currentQueryOnly = Object.fromEntries(
        Object.entries(qs.parse(queryString, URL_QS_PARSE_OPTIONS)).filter(
          ([key]) => !key.startsWith("drawer"),
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

      router.push(buildUrl(path, newQuery, hash), { replace: options.replace ?? false });
    },
    [router],
  );

  /**
   * Open a drawer with type-safe props.
   *
   * @example
   * openDrawer("promptEditor", { promptId: "abc" });
   * openDrawer("promptEditor", { promptId: "abc", urlParams: { targetId: "123" } });
   * openDrawer("promptEditor", { promptId: "abc" }, { resetStack: true });
   */
  const openDrawer = useCallback(
    <T extends DrawerTypeOf<R>>(
      drawer: T,
      props?: Partial<DrawerPropsOf<R, T>> & { urlParams?: Record<string, string> },
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
      // The host's own rewrite: every trace open lands on the Trace Explorer
      // drawer, from every entry point, rather than each call site choosing.
      const { drawer: effectiveDrawer, props: effectiveProps } = openRewrite(
        drawer,
        props as Record<string, unknown> | undefined,
      );

      // Extract urlParams and merge with props
      const { urlParams, ...drawerProps } = effectiveProps ?? {};
      const allParams = {
        ...drawerProps,
        ...(urlParams as Record<string, string> | undefined),
      } as Record<string, unknown>;

      // Read the open drawer from the router reading directly to get the
      // latest value.
      const currentDrawerNow = router.query["drawer.open"];

      // If the same drawer is already open, just update the URL params without
      // modifying the stack
      if (currentDrawerNow === effectiveDrawer) {
        updateDrawerUrl(effectiveDrawer, allParams, { replace: true });
        return;
      }

      // Manage drawer stack for navigation history
      if (resetStack || !currentDrawerNow) {
        // Reset stack - fresh start with no back navigation
        drawerStack = [{ drawer: effectiveDrawer, params: allParams }];
      } else if (replaceCurrentInStack && drawerStack.length > 0) {
        // Replace the current entry in the stack (useful for flow callbacks)
        // This makes "back" skip the replaced drawer
        drawerStack.pop();
        drawerStack.push({ drawer: effectiveDrawer, params: allParams });
      } else {
        // A drawer is already open - navigating forward, push to stack.
        // An empty stack means the open drawer came from a deep link or
        // outlived a reload, so seed it from the URL the browser is actually
        // on and back navigation can return there. It has to be the address
        // bar and not the router snapshot: the snapshot can still name a
        // drawer the reader has since dismissed, and seeding that one lets
        // back navigation bring a dismissed drawer back.
        if (drawerStack.length === 0) {
          const openInUrl = openDrawerInLocation();
          if (openInUrl) drawerStack.push({ drawer: openInUrl, params: {} });
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

        // A drawer appears in the stack once: opening one that is already in
        // it returns to that entry instead of stacking a second copy. Drawers
        // are non-modal, so the page behind one stays clickable. Without
        // this, reading a trace, adding it to a dataset and then clicking
        // another trace in the table leaves trace → dataset → trace, and
        // closing that trace walks back into a dataset drawer the reader had
        // already left behind.
        const existingIndex = drawerStack.findIndex((entry) => entry.drawer === effectiveDrawer);
        if (existingIndex !== -1) drawerStack.length = existingIndex;

        drawerStack.push({ drawer: effectiveDrawer, params: allParams });
      }

      const badKeys = Object.entries(allParams)
        .filter(([_, v]) => typeof v === "function" || typeof v === "symbol")
        .map(([k]) => k);
      if (badKeys.length > 0) {
        logger.warn(
          `Non-serializable props passed to drawer "${effectiveDrawer}": ${badKeys.join(", ")}. ` +
            `Consider using setFlowCallbacks() for callbacks that need to persist across navigation.`,
        );
      }

      updateDrawerUrl(effectiveDrawer, allParams, { replace });
    },
    [router, updateDrawerUrl],
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

    // Build clean URL from the address the reader is on, so filter params it
    // carries survive the close.
    const { path, queryString: currentQs, hash } = splitAsPath(router.asPath);
    const parsedQuery = qs.parse(currentQs, URL_QS_PARSE_OPTIONS);
    const cleanQuery = Object.fromEntries(
      Object.entries(parsedQuery).filter(([key]) => !key.startsWith("drawer") && key !== "span"),
    );
    const newQueryString = qs.stringify(cleanQuery, {
      allowDots: true,
      arrayFormat: "comma",
      allowEmptyArrays: true,
    });

    router.push(buildUrl(path, newQueryString, hash));
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
      setFlowCallbacks: setFlowCallbacks as <T extends DrawerTypeOf<R>>(
        drawer: T,
        callbacks: DrawerCallbacksOf<R, T>,
        options?: { keepOnClose?: boolean },
      ) => void,
      getFlowCallbacks: getFlowCallbacks as <T extends DrawerTypeOf<R>>(
        drawer: T,
      ) => DrawerCallbacksOf<R, T> | undefined,
    }),
    [openDrawer, closeDrawer, drawerOpen, goBack, canGoBack, currentDrawer],
  );
};
