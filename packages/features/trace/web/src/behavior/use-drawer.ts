/**
 * The overlay address, as this package writes it.
 *
 * `~/hooks/useDrawer` is the application's drawer navigator: a module-level
 * stack, a complex-props register, a flow-callback registry and a `qs` writer
 * over the browser URL. A feature-web package may own none of that — the
 * registry that turns `drawer.open=…` into a component is composition, and the
 * chrome layout route that mounts it is the application's.
 *
 * What a screen ever needed is the ADDRESS, which is what this writes. The
 * convention is `platform/app`'s unchanged: `drawer.open` names the overlay and
 * `drawer.<key>` carries one serialisable prop each, every stale `drawer.*` key
 * cleared on a fresh open. So a link this package produces is the same link the
 * application produces, and every overlay comes back for free the moment a
 * chrome layout route mounts `CurrentDrawer` above a package-served screen.
 *
 * THE CHROME GAP IS RECORDED RATHER THAN PAPERED OVER. `addDatasetRecord`,
 * `evaluatorEditor`, `onlineEvaluation`, `promptEditor`, `automation` and
 * `scenarioRunDetail` are other features' overlays, registered in
 * `platform/app`. On a screen served from `apps/ui` the address changes and
 * nothing opens — the same gap the me, automations, annotations, analytics and
 * evaluator families each recorded. `traceV2Details` is this family's own and
 * does not have the problem: `GlobalTraceV2DrawerMount` mounts it from the
 * explorer's own store, inside the screen.
 *
 * WHAT DID NOT TRAVEL, and each is deliberate:
 *
 * - COMPLEX PROPS. They were the application's way of handing a function to a
 *   lazily-mounted drawer; nothing addressable survives a reload, and a screen
 *   that needs a callback renders its own overlay inline instead.
 * - FLOW CALLBACKS. Same reason, and no caller in this family registered one.
 */

import { useCallback, useMemo } from "react";

import { useRouter } from "./next-router";

/** Any overlay the application registers. Untyped here on purpose: the registry is not this package's. */
export type DrawerType = string;
export type DrawerProps<_T extends DrawerType = DrawerType> = Record<string, unknown>;
export type DrawerCallbacks<_T extends DrawerType = DrawerType> = Record<string, unknown>;

/**
 * The navigation history, module-level exactly as `platform/app` keeps it.
 *
 * It has to outlive any one component: a drawer that opens another drawer is
 * unmounted by the time the second one is closed, so the entry to return to
 * cannot live in either one's state. Its whole hazard is that it is GLOBAL —
 * it can be describing an overlay the reader already dismissed — which is why
 * `getTopDrawer` reads the address bar and the trace drawer checks the two
 * against each other before asking to go back. See
 * specs/traces-v2/drawer-stacking.feature.
 */
type DrawerStackEntry = { drawer: DrawerType; params: Record<string, unknown> };

let drawerStack: DrawerStackEntry[] = [];

export function getDrawerStack(): readonly DrawerStackEntry[] {
  return drawerStack;
}

export function clearDrawerStack(): void {
  drawerStack = [];
}

/**
 * The overlay on top of the STACK, read outside React.
 *
 * Deliberately not the address bar. The trace drawer mounts from its own store
 * rather than from the URL, so the address can say `traceV2Details` while the
 * stack is describing something the reader has already left — and asking to go
 * back then walks into an overlay they dismissed. Comparing the two is what the
 * scaffold does before it chooses between going back and closing.
 */
export function getTopDrawer(): DrawerType | undefined {
  return drawerStack[drawerStack.length - 1]?.drawer;
}

/**
 * The overlay the address bar has open right now.
 *
 * `router.query` is a render snapshot and can lag a navigation that already
 * landed, so seeding an empty stack reads the address rather than the snapshot.
 */
function openDrawerInLocation(): DrawerType | undefined {
  if (typeof window === "undefined") return void 0;
  return new URLSearchParams(window.location.search).get("drawer.open") ?? void 0;
}

/** The address the reader is on, split into its path and its query. */
function readAddress(asPath: string): { path: string; query: URLSearchParams } {
  const [path, search = ""] = asPath.split("?");
  return { path: path ?? "", query: new URLSearchParams(search.split("#")[0] ?? "") };
}

function buildAddress(path: string, query: URLSearchParams): string {
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

/** Every `drawer.<key>` on the address except `open`. */
export function useDrawerParams(): Record<string, string | undefined> {
  const router = useRouter();
  const query = router.query;
  return useMemo(() => {
    const params: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(query)) {
      if (key.startsWith("drawer.") && key !== "drawer.open") {
        params[key.slice("drawer.".length)] = value;
      }
    }
    return params;
  }, [query]);
}

/** Updates individual `drawer.<key>` params without replacing the open overlay. */
export function useUpdateDrawerParams() {
  const router = useRouter();
  return useCallback(
    (updates: Record<string, string | undefined>, options: { push?: boolean } = {}) => {
      const { path, query } = readAddress(router.asPath);
      for (const [key, value] of Object.entries(updates)) {
        if (value === void 0) query.delete(`drawer.${key}`);
        else query.set(`drawer.${key}`, value);
      }
      void router[(options.push ?? true) ? "push" : "replace"](buildAddress(path, query));
    },
    [router],
  );
}

/** Only what a URL can carry travels; anything else is dropped. */
function serialisable(value: unknown): string | undefined {
  if (value === null || value === void 0) return void 0;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.every(
      (item) => item !== null && typeof item !== "object" && typeof item !== "function",
    )
      ? value.join(",")
      : void 0;
  }
  return void 0;
}

export function useDrawer() {
  const router = useRouter();
  const currentDrawer = router.query["drawer.open"];

  /** Writes one overlay's address, clearing whatever `drawer.*` keys stood before it. */
  const writeDrawer = useCallback(
    (drawer: DrawerType, params: Record<string, unknown>, options: { replace?: boolean } = {}) => {
      const { path, query } = readAddress(router.asPath);
      for (const key of [...query.keys()]) {
        if (key.startsWith("drawer.")) query.delete(key);
      }
      query.set("drawer.open", drawer);
      for (const [key, value] of Object.entries(params)) {
        const written = serialisable(value);
        if (written !== void 0) query.set(`drawer.${key}`, written);
      }
      void router[options.replace ? "replace" : "push"](buildAddress(path, query));
    },
    [router],
  );

  const openDrawer = useCallback(
    (
      drawer: DrawerType,
      props?: Record<string, unknown> & { urlParams?: Record<string, string> },
      options: { replace?: boolean; resetStack?: boolean } = {},
    ) => {
      const { urlParams, ...rest } = props ?? {};
      const params: Record<string, unknown> = { ...rest, ...(urlParams ?? {}) };
      const openNow = router.query["drawer.open"];

      if (openNow === drawer) {
        writeDrawer(drawer, params, { replace: true });
        return;
      }
      if (options.resetStack || !openNow) {
        drawerStack = [{ drawer, params }];
      } else {
        // An empty stack means the open overlay came from a deep link or
        // outlived a reload, so seed it from the address the browser is
        // actually on and back navigation can return there.
        if (drawerStack.length === 0) {
          const openInUrl = openDrawerInLocation();
          if (openInUrl) drawerStack.push({ drawer: openInUrl, params: {} });
        }

        // Snapshot the current address onto the entry being left, so going back
        // restores the whole state and not only the overlay's name.
        const top = drawerStack[drawerStack.length - 1];
        if (top && top.drawer === openNow) {
          const carried: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(router.query)) {
            if (key.startsWith("drawer.") && key !== "drawer.open") {
              carried[key.slice("drawer.".length)] = value;
            }
          }
          top.params = carried;
        }

        // An overlay appears in the stack once: opening one that is already in
        // it returns to that entry rather than stacking a second copy. Without
        // this, reading a trace, adding it to a dataset and then clicking
        // another trace leaves trace -> dataset -> trace, and closing that trace
        // walks back into a dataset drawer the reader had already left.
        const existing = drawerStack.findIndex((entry) => entry.drawer === drawer);
        if (existing !== -1) drawerStack.length = existing;

        drawerStack.push({ drawer, params });
      }

      writeDrawer(drawer, params, { replace: options.replace });
    },
    [router, writeDrawer],
  );

  const closeDrawer = useCallback(() => {
    drawerStack = [];
    const { path, query } = readAddress(router.asPath);
    for (const key of [...query.keys()]) {
      if (key.startsWith("drawer.") || key === "span") query.delete(key);
    }
    void router.push(buildAddress(path, query));
  }, [router]);

  /**
   * Back to the overlay this one was opened from, or closed when there is none.
   *
   * The entry being left is popped first, so a stack of one is a close.
   */
  const goBack = useCallback(() => {
    if (drawerStack.length <= 1) {
      closeDrawer();
      return;
    }
    drawerStack.pop();
    const previous = drawerStack[drawerStack.length - 1];
    if (!previous) {
      closeDrawer();
      return;
    }
    writeDrawer(previous.drawer, previous.params, { replace: true });
  }, [closeDrawer, writeDrawer]);

  const drawerOpen = useCallback(
    (drawer: DrawerType) => router.query["drawer.open"] === drawer,
    [router.query],
  );

  return useMemo(
    () => ({
      openDrawer,
      closeDrawer,
      drawerOpen,
      goBack,
      canGoBack: drawerStack.length > 1,
      currentDrawer,
      setFlowCallbacks: (_drawer: DrawerType, _callbacks: DrawerCallbacks) => void 0,
      getFlowCallbacks: (_drawer: DrawerType): DrawerCallbacks | undefined => void 0,
    }),
    [openDrawer, closeDrawer, drawerOpen, goBack, currentDrawer],
  );
}
