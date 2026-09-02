/**
 * The drawer registry MECHANISM, without a single drawer in it.
 *
 * `platform/app/src/components/drawerRegistry.ts` was one file that did two
 * jobs: it held the lazy-loading machinery, and it named forty-five components
 * by module path. The machinery is framework-level and lives here; the names
 * are composition and live where the application composes its features, exactly
 * as `installed-ui-features.ts` composes screens. A feature package publishes
 * its own `{ key: LazyComponent }` map and the host spreads them together.
 *
 * All drawers stay lazy so their transitive dependencies (monaco-editor, shiki,
 * the OTel SDK) stay out of the initial bundle. `CurrentDrawer` wraps rendering
 * in `<Suspense>`, so this just works.
 */

import { type ComponentProps, type ComponentType, lazy } from "react";

/**
 * One drawer, as the registry holds it.
 *
 * `ComponentType` rather than `FC`, and the width is load-bearing: a drawer is
 * mounted by the application's own feature wrapper (`withEvaluatorHost` and its
 * siblings), whose return type is `ComponentType`. Narrowing to `FC` would make
 * every host-wrapped drawer unregisterable.
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
 * Fetch a drawer's code before something opens it.
 *
 * Each drawer is its own download, so the first open of one waits on the
 * network with only the Suspense spinner on screen. A screen that knows which
 * drawer its rows open warms it while the person is still reading, and the
 * click then opens the drawer straight away. The bundler keeps the module, so a
 * repeat call costs nothing, and a drawer whose shell is mounted by its page
 * has no chunk of its own to warm.
 *
 * `warm` IS A PARAMETER RATHER THAN AN IMPORT. The application's own warm-up
 * (`@langwatch/ui`'s `warmChunk`) records a failed fetch so the global
 * `vite:preloadError` listener does not force a page reload for a warm-up
 * nobody was waiting on. A package may not import the application, so the host
 * passes its warmer in and the plain load is the default.
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

  const load = warm ?? ((run: () => Promise<unknown>) => run().then(() => true, () => false));
  return load(factory).then((loaded) =>
    loaded ? primeLazyComponent(component) : undefined,
  );
}

/**
 * Tell a `lazy()` wrapper that its module is already here.
 *
 * The wrapper keeps its own loaded state, apart from the module cache, so a
 * warmed drawer still suspends on its first render and paints the spinner for a
 * moment. Reading the wrapper once outside render settles that state, and the
 * drawer then renders on the first try. The read throws the promise the wrapper
 * is waiting on, which is how a `lazy()` reports that it is not ready yet, so
 * the throw is the expected path and not a failure. Waiting on that promise is
 * what makes the drawer ready by the time this resolves.
 *
 * Called only once the module is in memory: a wrapper that is told to load and
 * fails remembers the failure for the life of the page, which would turn a
 * warm-up that lost the network into a drawer that can never open.
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
    // Duck-typed rather than `pending instanceof Promise`. A promise carries
    // the identity of the realm that created it, and `instanceof` compares
    // against the `Promise` of the realm running this line — so the moment the
    // two differ, the check is false for a perfectly good promise and this
    // returns WITHOUT waiting for the chunk. The drawer is then reported as
    // primed while still pending, and renders its spinner after all.
    //
    // A browser has one realm, so this was invisible in production and stayed
    // invisible in tests until the suite moved to a pool that runs each file in
    // a VM context. `then` is what React itself looks for, and what the promise
    // contract actually specifies; realm identity was never the question being
    // asked. `Promise.resolve()` adopts the foreign thenable into a real promise
    // of THIS realm, which is both what the signature asks for and the right
    // semantics: a bare PromiseLike carries no `catch`/`finally`, and callers
    // await this like any other promise.
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
 * A drawer name, as the address bar spells it.
 *
 * `platform/app` derived this from `keyof typeof drawers`, which only worked
 * while ONE module named every drawer in the product. The registry is composed
 * now, so the navigator is generic over it: `useDrawer<typeof installedDrawers>()`
 * gets the same per-drawer prop checking at the call site, and a caller that
 * does not name a registry gets strings.
 */
export type DrawerTypeOf<R extends UiDrawerRegistry> = keyof R & string;

/** The props of one named drawer in a registry. */
export type DrawerPropsOf<
  R extends UiDrawerRegistry,
  T extends DrawerTypeOf<R>,
> = ComponentProps<R[T]>;

/**
 * Only the callback (function) props of one named drawer.
 *
 * Used for type-safe flow callback registration.
 */
export type DrawerCallbacksOf<R extends UiDrawerRegistry, T extends DrawerTypeOf<R>> = {
  [K in keyof DrawerPropsOf<R, T> as DrawerPropsOf<R, T>[K] extends
    // oxlint-disable-next-line no-explicit-any
    ((...args: any[]) => any) | undefined
    ? K
    : never]?: DrawerPropsOf<R, T>[K];
};

/** Maps drawer names to their callback props. */
export type FlowCallbacksRegistryOf<R extends UiDrawerRegistry> = {
  [T in DrawerTypeOf<R>]?: DrawerCallbacksOf<R, T>;
};
