/**
 * The drawer registry MECHANISM, without a single drawer in it. A feature
 * package publishes its own `{ key: LazyComponent }` map and the host spreads
 * them together, so this stays framework-level while drawer names live where
 * features are composed. All drawers stay lazy so their transitive
 * dependencies (monaco-editor, shiki, the OTel SDK) stay out of the bundle.
 */

import { type ComponentProps, type ComponentType, lazy } from "react";

/**
 * `ComponentType` rather than `FC`: a drawer is mounted by the host's feature
 * wrapper (`withEvaluatorHost` and siblings), whose return type is
 * `ComponentType`, so narrowing to `FC` would make it unregisterable.
 */
// oxlint-disable-next-line no-explicit-any
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
 * A lazy drawer built from a named export.
 *
 * Preserves the original export's name on the lazy wrapper so React DevTools
 * and the double-mount regression tests can still identify the drawer behind
 * it.
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
 * Fetch a drawer's code before something opens it, so a screen that knows
 * which drawer its rows open can warm it while the person is still reading.
 * `warm` is a parameter rather than an import because a package may not
 * import the application, and the host's own warm-up (`@langwatch/ui`'s
 * `warmChunk`) records failed fetches so a lost warm-up never forces a reload.
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
 * Tell a `lazy()` wrapper that its module is already here, so a warmed
 * drawer doesn't still suspend and paint a spinner on its first render.
 * Call only once the module is in memory: a wrapper told to load that fails
 * remembers the failure for the life of the page, turning a warm-up that
 * lost the network into a drawer that can never open.
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
 * A drawer name, as the address bar spells it. The navigator is generic over
 * the registry (`useDrawer<typeof installedDrawers>()`) so per-drawer prop
 * checking works at the call site even though drawers are composed rather
 * than named by one module; a caller that names no registry gets strings.
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
      // oxlint-disable-next-line no-explicit-any
      ((...args: any[]) => any) | undefined
      ? K
      : never
  ]?: DrawerPropsOf<R, T>[K];
};

/** Maps drawer names to their callback props. */
export type FlowCallbacksRegistryOf<R extends UiDrawerRegistry> = {
  [T in DrawerTypeOf<R>]?: DrawerCallbacksOf<R, T>;
};
