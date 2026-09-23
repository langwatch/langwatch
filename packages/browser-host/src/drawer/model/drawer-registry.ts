/**
 * The drawer registry MECHANISM, without a single drawer in it. A feature
 * package publishes its own `{ key: LazyComponent }` map; all drawers stay
 * lazy so monaco, shiki and the OTel SDK stay out of the bundle.
 */

import { type ComponentProps, type ComponentType, lazy } from "react";

/**
 * `ComponentType`, not `FC`: mounted by the host's feature wrapper
 * (`withEvaluatorHost` and siblings), whose return type is `ComponentType`.
 */
export type UiDrawerComponent = ComponentType<any>;

/**
 * What a feature package publishes and the host spreads together.
 *
 * The keys are the names the address bar uses: `?drawer.open=<key>`.
 */
export type UiDrawerRegistry = Record<string, UiDrawerComponent>;

/** The import behind each lazy drawer, so a screen can fetch it early. */
const chunkFactories = new WeakMap<object, () => Promise<unknown>>();

/**
 * A lazy drawer built from a named export. Preserves the original export's
 * name on the lazy wrapper so React DevTools and the double-mount regression
 * tests can still identify the drawer behind it.
 */
export const lazyDrawer = <K extends string, T extends { [P in K]: UiDrawerComponent }>({
  factory,
  key,
}: {
  factory: () => Promise<T>;
  key: K;
}): UiDrawerComponent => {
  const Component = lazy(() => factory().then((m) => ({ default: m[key] })));
  Object.defineProperty(Component, "name", { value: key });
  chunkFactories.set(Component, factory);
  return Component as UiDrawerComponent;
};

/**
 * Fetch a drawer's code before something opens it. `warm` is a parameter,
 * not an import, since a package may not import the application; the
 * host's own `warmChunk` never forces a reload on a lost fetch.
 */
export function preloadDrawer({
  registry,
  drawer,
  warm,
}: {
  registry: UiDrawerRegistry;
  drawer: string;
  warm?: (load: () => Promise<unknown>) => Promise<boolean>;
}): Promise<void> {
  const component = registry[drawer];
  if (!component) return Promise.resolve();
  const factory = chunkFactories.get(component);
  if (!factory) return Promise.resolve();

  const load =
    warm ??
    ((run: () => Promise<unknown>) =>
      run().then(
        () => true,
        () => false,
      ));
  return load(factory).then((loaded) => (loaded ? primeLazyComponent(component) : undefined));
}

/**
 * Tell a `lazy()` wrapper that its module is already here, so it doesn't
 * still suspend on first render. Call only once the module is in memory: a
 * failed load is remembered for the page's life, closing the drawer forever.
 */
export function primeLazyComponent(component: object): Promise<void> {
  const wrapper = component as {
    _init?: (payload: unknown) => unknown;
    _payload?: unknown;
  };
  if (typeof wrapper._init !== "function") return Promise.resolve();

  try {
    wrapper._init(wrapper._payload);
    return Promise.resolve();
  } catch (pending) {
    // Duck-typed rather than `pending instanceof Promise`: a promise carries
    // the identity of the realm that created it, so `instanceof` goes false
    // across realms (as under a VM-context test pool) for a perfectly good
    // promise, wrongly reporting the drawer primed while still pending.
    // `Promise.resolve()` adopts the foreign thenable into this realm's own.
    return isThenable(pending)
      ? Promise.resolve(pending).then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
  }
}

/** Whether a value follows the promise contract, whatever realm made it. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

/**
 * A drawer name, as the address bar spells it. Generic over the registry
 * (`useDrawer<typeof installedDrawers>()`) so per-drawer prop checking works
 * even though drawers are composed rather than named by one module.
 */
export type DrawerTypeOf<R extends UiDrawerRegistry> = keyof R & string;

/** The props of one named drawer in a registry. */
export type DrawerPropsOf<R extends UiDrawerRegistry, T extends DrawerTypeOf<R>> = ComponentProps<
  R[T]
>;

/**
 * Only the callback (function) props of one named drawer.
 *
 * Used for type-safe flow callback registration.
 */
export type DrawerCallbacksOf<R extends UiDrawerRegistry, T extends DrawerTypeOf<R>> = {
  [
    K in keyof DrawerPropsOf<R, T> as DrawerPropsOf<R, T>[K] extends
      | ((...args: never[]) => unknown)
      | undefined
      ? K
      : never
  ]?: DrawerPropsOf<R, T>[K];
};

/** Maps drawer names to their callback props. */
export type FlowCallbacksRegistryOf<R extends UiDrawerRegistry> = {
  [T in DrawerTypeOf<R>]?: DrawerCallbacksOf<R, T>;
};
