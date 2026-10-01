/**
 * URL-routed singleton drawers: the address vocabulary. The stack of drawers
 * is the address plus `history.state`; nothing about it lives in memory.
 */

import type { UiDrawerToken, UiTokenIdentity } from "@langwatch/kernel/contract";
import { createLogger } from "@langwatch/observability/browser";
import qs from "qs";
import { useCallback, useMemo } from "react";

import type {
  DrawerCallbacksIn,
  UiDrawerMap,
  UiDrawerPropsOf,
  UiFlowCallbacksStore,
  UndeclaredDrawerCallbacks,
} from "../model/drawer-map.ts";
import {
  ancestorsAfterOpen,
  type DrawerStackEntry,
  drawerAncestorsState,
  drawerParamsOfQuery,
  readDrawerAncestors,
  readDrawerStack,
} from "../model/drawer-stack.ts";
import { URL_QS_PARSE_OPTIONS } from "../model/qs-parse-options.ts";
import { drawerRouterRef, readDrawerLocation, useDrawerRouter } from "./drawer-router.ts";

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
let flowCallbacks: UiFlowCallbacksStore = {};

/**
 * Drawers whose callback belongs to a mounted component, not a drawer flow:
 * closing an unrelated drawer must not clear it, since the owning component
 * would never learn its callback was gone.
 */
const keptOnClose = new Set<string>();

type FlowCallbackOptions = {
  /**
   * True when a mounted component owns the registration, so that closing a
   * drawer leaves it alone. The owner takes it back on unmount, by
   * registering an empty set.
   */
  keepOnClose?: boolean;
};

/** A drawer's address name: a token's wire name, or the string itself. */
const drawerKey = (drawer: string | UiTokenIdentity): string =>
  typeof drawer === "string" ? drawer : drawer.key;

/**
 * Sets flow callbacks for a drawer, named by its owner's token or, while the
 * string path stays, by name; they persist across navigation until
 * closeDrawer() is called.
 */
export function setFlowCallbacks<Props>(
  drawer: UiDrawerToken<Props>,
  callbacks: DrawerCallbacksIn<Props>,
  options?: FlowCallbackOptions,
): void;
export function setFlowCallbacks<Name extends string>(
  drawer: Name,
  callbacks: NonNullable<UiFlowCallbacksStore[Name]>,
  options?: FlowCallbackOptions,
): void;
export function setFlowCallbacks(
  drawer: string | UiTokenIdentity,
  callbacks: UndeclaredDrawerCallbacks,
  options?: FlowCallbackOptions,
): void {
  // Deliberately does NOT notify: callers register callbacks before opening a
  // drawer, or right before a setComplexProps that does notify; a notify here
  // would cascade a re-render through the open drawer on every registration.
  const key = drawerKey(drawer);
  flowCallbacks[key] = callbacks;
  if (options?.keepOnClose) keptOnClose.add(key);
  else keptOnClose.delete(key);
}

/**
 * Get flow callbacks for a specific drawer, by token or by name.
 * Returns undefined if no callbacks are registered for this drawer.
 */
export function getFlowCallbacks<Props>(
  drawer: UiDrawerToken<Props>,
): DrawerCallbacksIn<Props> | undefined;
export function getFlowCallbacks<Name extends string>(drawer: Name): UiFlowCallbacksStore[Name];
export function getFlowCallbacks(
  drawer: string | UiTokenIdentity,
): UndeclaredDrawerCallbacks | undefined {
  return flowCallbacks[drawerKey(drawer)];
}

/**
 * Clears the flow callbacks of the drawer flows; called automatically by
 * closeDrawer(). What a mounted component registered with `keepOnClose`
 * stays: it belongs to that component, still expecting to be called.
 */
export const clearFlowCallbacks = () => {
  const kept: UiFlowCallbacksStore = {};
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
// Drawer Stack (read from the address and history.state)
// ============================================================================

/** The whole stack, the open drawer on top; empty when none is open. */
export const getDrawerStack = (): DrawerStackEntry[] => readDrawerStack(readDrawerLocation());

/** The open drawer, or `undefined`; read from the address, so never stale. */
export const getTopDrawer = (): DrawerType | undefined => readDrawerLocation().query["drawer.open"];

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

/** The drawers beneath `next` once it opens over the address `query`/`state` describe. */
function ancestorsForOpen({
  query,
  state,
  next,
  resetStack,
  replaceCurrentInStack,
}: {
  query: Readonly<Record<string, string | undefined>>;
  state: unknown;
  next: DrawerType;
  resetStack?: boolean;
  replaceCurrentInStack?: boolean;
}): DrawerStackEntry[] {
  const open = query["drawer.open"];
  return ancestorsAfterOpen({
    ancestors: readDrawerAncestors(state),
    current: open ? { drawer: open, params: drawerParamsOfQuery(query) } : undefined,
    next,
    resetStack,
    replaceCurrentInStack,
    forward: open === next,
  });
}

/**
 * Navigate to a drawer from module-level code (e.g., flow callbacks).
 * This is useful when the callback is captured from a component that may not be
 * mounted.
 */
export const navigateToDrawer = (drawer: DrawerType, options: { resetStack?: boolean } = {}) => {
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
  const ancestors = ancestorsForOpen({
    query: router.query,
    state: router.state,
    next: drawer,
    resetStack: options.resetStack,
  });

  const { hash } = splitAsPath(liveAsPath(router.asPath));
  const newQs = qs.stringify(newQuery, { allowDots: true, arrayFormat: "comma" });
  router.push(buildUrl(router.pathname, newQs, hash), {
    state: drawerAncestorsState(ancestors),
  });
};

// ============================================================================
// URL Params
// ============================================================================

/**
 * Updates `drawer.<key>` params in the URL without touching the rest of the
 * query, the open drawer or the stack. `push: true` (default) adds a history
 * entry; pass `push: false` for silent updates.
 */
export function updateDrawerParams(
  updates: Record<string, string | undefined>,
  options: { push?: boolean } = {},
): void {
  const router = drawerRouterRef.current;
  if (!router) {
    logger.warn(
      "updateDrawerParams ran with no mounted drawer navigator; the address was not written.",
    );
    return;
  }
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
  router.push(buildUrl(path, newQs, hash), { replace: !push, state: router.state });
}

/** `updateDrawerParams`, once a navigator is mounted for it to write through. */
export const useUpdateDrawerParams = () => {
  useDrawerRouter();
  return updateDrawerParams;
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
export function splitAsPath(asPath: string): {
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

/** The one-level object a drawer's `urlParams` is; anything else adds nothing. */
function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

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

function warnNonSerializableProps({
  drawer,
  params,
}: {
  drawer: DrawerType;
  params: Record<string, unknown>;
}): void {
  const badKeys = Object.entries(params)
    .filter(([, v]) => typeof v === "function" || typeof v === "symbol")
    .map(([k]) => k);
  if (badKeys.length === 0) return;
  logger.warn(
    `Non-serializable props passed to drawer "${drawer}": ${badKeys.join(", ")}. ` +
      `Consider using setFlowCallbacks() for callbacks that need to persist across navigation.`,
  );
}

type OpenOptions = { replace?: boolean; resetStack?: boolean; replaceCurrentInStack?: boolean };

type UpdateDrawerUrl = (
  drawer: DrawerType,
  props?: Record<string, unknown>,
  options?: { replace?: boolean; state?: unknown },
) => void;

/** `openDrawer`'s two spellings: by the owner's token, or by name. */
type OpenDrawer<Map extends object> = {
  <Props>(
    drawer: UiDrawerToken<Props>,
    props?: Partial<Props> & { urlParams?: Record<string, string> },
    options?: OpenOptions,
  ): void;
  <Name extends string>(
    drawer: Name,
    props?: Partial<UiDrawerPropsOf<Map, Name>> & { urlParams?: Record<string, string> },
    options?: OpenOptions,
  ): void;
};

function openOn({
  updateDrawerUrl,
  drawer,
  props,
  options = {},
}: {
  updateDrawerUrl: UpdateDrawerUrl;
  drawer: string | UiTokenIdentity;
  props?: object;
  options?: OpenOptions;
}): void {
  const { replace, resetStack, replaceCurrentInStack } = options;
  // The host's own rewrite: every trace open lands on the Trace Explorer
  // drawer, from every entry point, rather than each call site choosing.
  const { drawer: effectiveDrawer, props: effectiveProps } = openRewrite(
    drawerKey(drawer),
    props === undefined ? undefined : toRecord(props),
  );

  // Extract urlParams and merge with props
  const { urlParams, ...drawerProps } = effectiveProps ?? {};
  const allParams: Record<string, unknown> = { ...drawerProps, ...toRecord(urlParams) };

  const { query, state } = readDrawerLocation();

  // The same drawer is already open: update its params where it stands.
  if (query["drawer.open"] === effectiveDrawer && replace !== false) {
    updateDrawerUrl(effectiveDrawer, allParams, { replace: true, state });
    return;
  }

  warnNonSerializableProps({ drawer: effectiveDrawer, params: allParams });

  updateDrawerUrl(effectiveDrawer, allParams, {
    replace,
    state: drawerAncestorsState(
      ancestorsForOpen({
        query,
        state,
        next: effectiveDrawer,
        resetStack,
        replaceCurrentInStack,
      }),
    ),
  });
}

/**
 * Manages drawer state via the address, with the stack in `history.state` for
 * the back button. Generic over the registry so a caller naming the
 * application's registry gets per-drawer prop checking; others just get strings.
 */
export const useDrawer = <Map extends object = UiDrawerMap>() => {
  const router = useDrawerRouter();

  const currentDrawer = router.query["drawer.open"];
  const backStack = useMemo(
    () => (currentDrawer ? readDrawerAncestors(router.state) : []),
    [currentDrawer, router.state],
  );

  /** Writes the address for a drawer and the stack that sits beneath it. */
  const updateDrawerUrl = useCallback(
    (
      drawer: DrawerType,
      props?: Record<string, unknown>,
      options: { replace?: boolean; state?: unknown } = {},
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

      // Build query from the actual browser URL, not a params snapshot: this
      // preserves filter params the address carries and the snapshot does not.
      const { path, queryString, hash } = splitAsPath(liveAsPath(readDrawerLocation().asPath));
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

      router.push(buildUrl(path, newQuery, hash), {
        replace: options.replace ?? false,
        state: options.state,
      });
    },
    [router],
  );

  /**
   * Open a drawer with type-safe props: by its owner's token, or by name
   * while the string path stays. Opening the drawer that is already open
   * updates its params in place, unless `replace: false` asks to go forward.
   */
  const openDrawer: OpenDrawer<Map> = useCallback(
    (drawer: string | UiTokenIdentity, props?: object, options?: OpenOptions) =>
      openOn({ updateDrawerUrl, drawer, props, options }),
    [updateDrawerUrl],
  );

  /**
   * Close the current drawer.
   * Also clears the drawers beneath it and the flow callbacks.
   */
  const closeDrawer = useCallback(() => {
    clearFlowCallbacks();
    complexProps = {};

    // Build clean URL from the address the reader is on, so filter params it
    // carries survive the close.
    const {
      path,
      queryString: currentQs,
      hash,
    } = splitAsPath(liveAsPath(readDrawerLocation().asPath));
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
   * Go back to the drawer at `index` beneath the open one, dropping it and
   * everything above. Nothing at `index` closes the drawer entirely.
   */
  const goBackTo = useCallback(
    (index: number) => {
      const ancestors = readDrawerAncestors(readDrawerLocation().state);
      const target = ancestors[index];
      if (!target) {
        closeDrawer();
        return;
      }
      // Push, so the next browser Back returns to the drawer this one left,
      // rather than landing on an entry that repeats the address.
      updateDrawerUrl(target.drawer, target.params, {
        state: drawerAncestorsState(ancestors.slice(0, index)),
      });
    },
    [closeDrawer, updateDrawerUrl],
  );

  /** Go back to the previous drawer; with none beneath, closes the drawer. */
  const goBack = useCallback(() => {
    goBackTo(readDrawerAncestors(readDrawerLocation().state).length - 1);
  }, [goBackTo]);

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
  const canGoBack = backStack.length > 0;

  return useMemo(
    () => ({
      openDrawer,
      closeDrawer,
      drawerOpen,
      goBack,
      goBackTo,
      canGoBack,
      backStack,
      currentDrawer,
      setFlowCallbacks,
      getFlowCallbacks,
    }),
    [openDrawer, closeDrawer, drawerOpen, goBack, goBackTo, canGoBack, backStack, currentDrawer],
  );
};
