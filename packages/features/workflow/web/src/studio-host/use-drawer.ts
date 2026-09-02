/**
 * The drawer navigation the moved studio modules already perform.
 *
 * `platform/app` routes its drawers through the address: `?drawer.open=<name>`
 * plus one `drawer.<key>` parameter per serialisable prop, with the
 * non-serialisable ones held in a module-scope store and a stack for the back
 * button. Sixteen files in the studio's closure drive that, and every one of
 * them keeps its call unchanged here — the address is written through
 * `WorkflowHostPort.setQuery`, which is the same query string by another name.
 *
 * WHAT DOES NOT TRAVEL, AND IT IS A REAL LOSS RATHER THAN AN OMISSION: nothing
 * RENDERS these drawers. `platform/app` mounts `CurrentDrawer` from its
 * dashboard chrome, and the studio — which has no chrome — used to mount a
 * second copy itself. A feature-web package cannot mount the application's
 * drawer registry, and `apps/ui` has no drawer host of its own yet, so a studio
 * that asks for `promptList` writes the address and nothing opens. The
 * navigation, the stack and the callbacks are all here and correct for the day
 * a drawer host exists; until then the pickers are inert. Recorded in the
 * family's manifest row rather than left to be discovered.
 */

import { useCallback, useMemo } from "react";

import { useRouter } from "./next-router";

/**
 * A drawer this application knows how to open, by the name the address uses.
 *
 * `platform/app` keyed these off its drawer REGISTRY, so `DrawerProps<"x">` and
 * `DrawerCallbacks<"x">` were the props and callbacks of one named drawer. That
 * registry is the application's — it imports every drawer in the product — and
 * a feature-web package may not name it, so the names are strings here and the
 * props are untyped.
 *
 * `any` RATHER THAN `unknown`, and the difference is load-bearing: a flow
 * callback is FETCHED and then CALLED (`getFlowCallbacks("promptList")?.onSelect(...)`),
 * and `unknown` is not callable. What is lost is the registry's per-drawer
 * checking; what is kept is that these call sites did not have to be rewritten.
 * It comes back when the drawer registry moves out of `platform/app`.
 */
export type DrawerType = string;
// oxlint-disable-next-line no-explicit-any
export type DrawerProps = Record<string, any>;
// oxlint-disable-next-line no-explicit-any
export type DrawerCallbacks<_T extends DrawerType = DrawerType> = Record<string, any>;

const DRAWER_PREFIX = "drawer.";
const DRAWER_OPEN = "drawer.open";

/**
 * Props a drawer needs that cannot survive a URL — functions and objects.
 * Replaced wholesale on each open, exactly as the application's store does.
 */
let complexProps: DrawerProps = {};
export const getComplexProps = (): DrawerProps => complexProps;
export const setComplexProps = (props: DrawerProps): void => {
  complexProps = { ...complexProps, ...props };
};

/** Callbacks that outlive a navigation between drawers within one flow. */
let flowCallbacks: Record<string, DrawerCallbacks> = {};
export const setFlowCallbacks = <T extends DrawerType>(
  drawer: T,
  callbacks: DrawerCallbacks<T>,
): void => {
  flowCallbacks[drawer] = callbacks as DrawerCallbacks;
};
export const getFlowCallbacks = <T extends DrawerType>(
  drawer: T,
): DrawerCallbacks<T> | undefined => flowCallbacks[drawer] as DrawerCallbacks<T> | undefined;
export const clearFlowCallbacks = (): void => {
  flowCallbacks = {};
};
export const getAllFlowCallbacks = (): Record<string, DrawerCallbacks> => flowCallbacks;

type DrawerStackEntry = { drawer: DrawerType; params: DrawerProps };
let drawerStack: DrawerStackEntry[] = [];
export const getDrawerStack = (): DrawerStackEntry[] => drawerStack;
export const clearDrawerStack = (): void => {
  drawerStack = [];
};
export const getTopDrawer = (): DrawerType | undefined =>
  drawerStack[drawerStack.length - 1]?.drawer;

/** Whether a value survives a round trip through a query string. */
function isUrlSerializable(value: unknown): boolean {
  if (value === null || value === void 0) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") return true;
  if (Array.isArray(value)) return value.every((entry) => isUrlSerializable(entry));
  return false;
}

function asQueryValue(value: unknown): string | undefined {
  if (value === null || value === void 0) return void 0;
  if (Array.isArray(value)) return value.join(",");
  return String(value);
}

export function useDrawer() {
  const router = useRouter();
  const currentDrawer = router.query[DRAWER_OPEN];

  /** Writes the whole next query: this drawer's parameters replace the last one's. */
  const writeDrawerAddress = useCallback(
    (drawer: DrawerType, props?: DrawerProps, options: { replace?: boolean } = {}) => {
      const serializable: DrawerProps = {};
      const complex: DrawerProps = {};
      for (const [key, value] of Object.entries(props ?? {})) {
        if (isUrlSerializable(value)) serializable[key] = value;
        else complex[key] = value;
      }
      complexProps = complex;

      const next: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(router.query)) {
        if (!key.startsWith(DRAWER_PREFIX)) next[key] = value;
      }
      next[DRAWER_OPEN] = drawer;
      for (const [key, value] of Object.entries(serializable)) {
        next[`${DRAWER_PREFIX}${key}`] = asQueryValue(value);
      }
      void (options.replace ? router.replace : router.push)(
        `?${new URLSearchParams(
          Object.entries(next).flatMap(([key, value]) =>
            value === void 0 ? [] : [[key, value] as [string, string]],
          ),
        ).toString()}`,
      );
    },
    [router],
  );

  const openDrawer = useCallback(
    (
      drawer: DrawerType,
      props?: DrawerProps,
      options: { replace?: boolean; resetStack?: boolean } = {},
    ) => {
      // `resetStack` starts a fresh flow: the back button then closes rather
      // than walking into whatever drawer the reader was in before.
      if (options.resetStack) drawerStack = [{ drawer, params: { ...(props ?? {}) } }];
      else drawerStack.push({ drawer, params: { ...(props ?? {}) } });
      writeDrawerAddress(drawer, props, options);
    },
    [writeDrawerAddress],
  );

  const closeDrawer = useCallback(() => {
    drawerStack = [];
    complexProps = {};
    clearFlowCallbacks();
    const next: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(router.query)) {
      if (!key.startsWith(DRAWER_PREFIX)) next[key] = value;
    }
    void router.push(
      `?${new URLSearchParams(
        Object.entries(next).flatMap(([key, value]) =>
          value === void 0 ? [] : [[key, value] as [string, string]],
        ),
      ).toString()}`,
    );
  }, [router]);

  const goBack = useCallback(() => {
    drawerStack.pop();
    const previous = drawerStack[drawerStack.length - 1];
    if (!previous) {
      closeDrawer();
      return;
    }
    writeDrawerAddress(previous.drawer, previous.params, { replace: true });
  }, [closeDrawer, writeDrawerAddress]);

  const drawerOpen = useCallback(
    (drawer: DrawerType) => router.query[DRAWER_OPEN] === drawer,
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
      setFlowCallbacks,
      getFlowCallbacks,
    }),
    [openDrawer, closeDrawer, drawerOpen, goBack, currentDrawer],
  );
}

/** The `drawer.<key>` parameters of the address, without the `drawer.` prefix. */
export function useDrawerParams(): Record<string, string | undefined> {
  const router = useRouter();
  const params: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(router.query)) {
    if (key.startsWith(DRAWER_PREFIX) && key !== DRAWER_OPEN) {
      params[key.slice(DRAWER_PREFIX.length)] = value;
    }
  }
  return params;
}
