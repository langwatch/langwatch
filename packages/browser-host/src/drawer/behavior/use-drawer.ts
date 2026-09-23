/**
 * URL-routed singleton drawers: the address vocabulary and the navigation
 * stack. The router and the trace-drawer funnel are redesigned here because
 * the platform import behind them has no package export.
 */

import { createLogger } from "@langwatch/observability/browser";
import qs from "qs";
import { useCallback, useMemo } from "react";

import type {
  DrawerCallbacksOf,
  DrawerPropsOf,
  DrawerTypeOf,
  UiDrawerRegistry,
} from "../model/drawer-registry.ts";
import { URL_QS_PARSE_OPTIONS } from "../model/qs-parse-options.ts";
import { type DrawerRouter, drawerRouterRef, useDrawerRouter } from "./drawer-router.ts";

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
// A non-URL change (e.g. rehydrating props from a store on reload) still needs
// CurrentDrawer to see it; this version counter + listener set drives that.
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
 * Merges non-serializable props into the CURRENT drawer's complexProps and
 * notifies subscribers, to (re)attach in-memory context WITHOUT a URL change.
 * `openDrawer` still fully REPLACES complexProps on open; this only augments.
 */
export const setComplexProps = (props: Record<string, unknown>): void => {
  complexProps = { ...complexProps, ...props };
  notifyDrawerPropsChanged();
};

// ============================================================================
// Flow Callbacks (persist across drawer navigation within a flow)
// ============================================================================

/**
 * Flow callbacks registry: persists across drawer navigation, and is cleared
 * on closeDrawer() except entries registered with `keepOnClose`.
 */
let flowCallbacks: Record<string, Record<string, unknown>> = {};

/**
 * Drawers whose callback belongs to a mounted component, not a drawer flow:
 * closing an unrelated drawer must not clear it, since the owning component
 * would never learn its callback was gone.
 */
const keptOnClose = new Set<string>();

/**
 * Sets flow callbacks for a drawer type; they persist across navigation until
 * closeDrawer() is called.
 */
export const setFlowCallbacks = (
  drawer: DrawerType,
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
  // Deliberately does NOT notify: callers register callbacks before opening a
  // drawer, or right before a setComplexProps that does notify — so a notify
  // here is redundant, and expensive (~65 call sites; would cascade a
  // re-render through the open drawer's subtree on every registration).
  flowCallbacks[drawer] = callbacks as Record<string, unknown>;
  if (options?.keepOnClose) keptOnClose.add(drawer);
  else keptOnClose.delete(drawer);
};

/**
 * Get flow callbacks for a specific drawer type.
 * Returns undefined if no callbacks are registered for this drawer.
 */
export const getFlowCallbacks = (drawer: DrawerType): Record<string, any> | undefined => {
  return flowCallbacks[drawer];
};

/**
 * Clears the flow callbacks of the drawer flows; called automatically by
 * closeDrawer(). What a mounted component registered with `keepOnClose`
 * stays: it belongs to that component, still expecting to be called.
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
 * The drawer on top of the stack, or `undefined` when empty. Checked by a
 * drawer that mounts from its own store, not the URL (Trace Explorer): the
 * stack is module-global, so a stale one walks back into an unrelated drawer.
 */
export const getTopDrawer = (): DrawerType | undefined =>
  drawerStack[drawerStack.length - 1]?.drawer;

// ============================================================================
// The open rewrite the host installs
// ============================================================================

/**
 * A rule that redirects one drawer-open request to another — e.g. rewriting a
 * `traceDetails` open to `traceV2Details`. This is a feature's rule, not the
 * framework's, so the application installs it rather than hard-coding it.
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
 * Updates `drawer.<key>` params in the URL without touching the rest of the
 * query or the open drawer. `push: true` (default) adds a history entry;
 * pass `push: false` for silent updates (e.g. mirroring state on mount).
 */
export const useUpdateDrawerParams = () => {
  const router = useDrawerRouter();
  return useCallback(
    (updates: Record<string, string | undefined>, options: { push?: boolean } = {}) => {
      const push = options.push ?? true;
      const { path, queryString, hash } = splitAsPath(liveAsPath(router.asPath));
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
 * Split an address into (path, query, hash), handling both `?q#h` and `#h?q`
 * orderings — needed for lens routes like `/traces#conversations`, where naive
 * concatenation parks query params after the hash, invisible to `location.search`.
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
    const query = rest.slice(1, h);
    const rescued = rescueFragmentQuery(rest.slice(h + 1));
    return {
      path,
      queryString: [query, rescued.queryString].filter(Boolean).join("&"),
      hash: rescued.hash,
    };
  }
  if (rest.startsWith("#")) {
    return { path, ...rescueFragmentQuery(rest.slice(1)) };
  }
  return { path, queryString: "", hash: "" };
}

/**
 * Pulls a fragment into its query-string part and its fragment part. Shared
 * by both `#h?q` and `?q#h` orderings so a `drawer.` param after `#` isn't
 * lost; only `drawer.`-prefixed pairs move, other bar state stays put.
 */
function rescueFragmentQuery(hash: string): {
  queryString: string;
  hash: string;
} {
  const q = hash.indexOf("?");
  if (q === -1) return { queryString: "", hash };
  const fragmentQuery = hash.slice(q + 1);
  if (!/(^|&)drawer\./.test(fragmentQuery)) return { queryString: "", hash };

  // Only the `drawer.` pairs move. A fragment query can hold both — the bar
  // sets `preset` and something then parks `drawer.open` alongside it — and
  // lifting the whole thing would carry `preset` out of the fragment its owner
  // reads, resetting the time range: the very bug this file is fixing.
  const lifted: string[] = [];
  const kept: string[] = [];
  for (const pair of fragmentQuery.split("&")) {
    if (!pair) continue;
    (pair.startsWith("drawer.") ? lifted : kept).push(pair);
  }
  const fragment = hash.slice(0, q);
  return {
    queryString: lifted.join("&"),
    hash: kept.length > 0 ? `${fragment}?${kept.join("&")}` : fragment,
  };
}

/**
 * `router.asPath` with its fragment replaced by the browser's live one: the
 * traces page writes fragment state via raw `history.replaceState`, which the
 * router never observes, so a stale hash must be swapped in before splitting.
 */
function liveAsPath(asPath: string): string {
  if (typeof window === "undefined") return asPath;
  const hashIdx = asPath.indexOf("#");
  const withoutHash = hashIdx === -1 ? asPath : asPath.slice(0, hashIdx);
  return withoutHash + window.location.hash;
}

function buildUrl(path: string, queryString: string, hash: string): string {
  let url = path;
  if (queryString) url += `?${queryString}`;
  if (hash) url += `#${hash}`;
  return url;
}

/**
 * Whether a value survives round-tripping through the URL query string.
 * Note: qs collapses single-element arrays to plain strings on round-trip
 * (`["a"]` → `"a"`), so consumers must handle both `T` and `T[]`.
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

// Records an open on the navigation stack: reset, replace the top, or push forward.
function pushDrawerStack({
  drawer,
  params,
  currentDrawerNow,
  query,
  resetStack,
  replaceCurrentInStack,
}: {
  drawer: DrawerType;
  params: Record<string, unknown>;
  currentDrawerNow: string | undefined;
  query: DrawerRouter["query"];
  resetStack?: boolean;
  replaceCurrentInStack?: boolean;
}): void {
  if (resetStack || !currentDrawerNow) {
    // Reset stack - fresh start with no back navigation
    drawerStack = [{ drawer, params }];
    return;
  }
  if (replaceCurrentInStack && drawerStack.length > 0) {
    // Replace the current entry in the stack (useful for flow callbacks)
    // This makes "back" skip the replaced drawer
    drawerStack.pop();
    drawerStack.push({ drawer, params });
    return;
  }
  // A drawer is already open - navigating forward, push to stack. An empty
  // stack means the drawer came from a deep link or outlived a reload, so seed
  // it from the address bar (not the router snapshot, which can still name a
  // drawer the reader has since dismissed) so back navigation can return there.
  if (drawerStack.length === 0) {
    const openInUrl = openDrawerInLocation();
    if (openInUrl) drawerStack.push({ drawer: openInUrl, params: {} });
  }

  snapshotTopEntryParams({ currentDrawerNow, query });

  // A drawer appears in the stack once: opening one already in it returns to
  // that entry instead of stacking a second copy. Without this, trace →
  // dataset → trace would leave closing the trace walking back into a dataset
  // drawer the reader had already left behind.
  const existingIndex = drawerStack.findIndex((entry) => entry.drawer === drawer);
  if (existingIndex !== -1) drawerStack.length = existingIndex;

  drawerStack.push({ drawer, params });
}

// Snapshot current URL params for the top-of-stack drawer so goBack
// restores the full state (e.g. selectedTab set after initial open)
function snapshotTopEntryParams({
  currentDrawerNow,
  query,
}: {
  currentDrawerNow: string;
  query: DrawerRouter["query"];
}): void {
  const topEntry = drawerStack[drawerStack.length - 1];
  if (topEntry?.drawer !== currentDrawerNow) return;
  const currentUrlParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith("drawer.") && key !== "drawer.open") {
      currentUrlParams[key.replace("drawer.", "")] = value;
    }
  }
  topEntry.params = currentUrlParams;
}

function warnNonSerializableProps({
  drawer,
  params,
}: {
  drawer: DrawerType;
  params: Record<string, unknown>;
}): void {
  const badKeys = Object.entries(params)
    .filter(([_, v]) => typeof v === "function" || typeof v === "symbol")
    .map(([k]) => k);
  if (badKeys.length === 0) return;
  logger.warn(
    `Non-serializable props passed to drawer "${drawer}": ${badKeys.join(", ")}. ` +
      `Consider using setFlowCallbacks() for callbacks that need to persist across navigation.`,
  );
}

/**
 * Manages drawer state via URL params, with a navigation stack for the back
 * button. Generic over the registry so a caller naming the application's
 * registry gets per-drawer prop checking; others just get strings.
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
      const { path, queryString, hash } = splitAsPath(liveAsPath(router.asPath));
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
   * @example
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

      pushDrawerStack({
        drawer: effectiveDrawer,
        params: allParams,
        currentDrawerNow,
        query: router.query,
        resetStack,
        replaceCurrentInStack,
      });
      warnNonSerializableProps({ drawer: effectiveDrawer, params: allParams });

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
    const { path, queryString: currentQs, hash } = splitAsPath(liveAsPath(router.asPath));
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
