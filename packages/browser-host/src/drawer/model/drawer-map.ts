/** The flow callbacks a drawer flow registers, by drawer name or owner token. */

/**
 * A callback of a drawer no map declares yet. A method type, so it compares bivariantly: a
 * handler typed for its own argument still registers, while the drawer is not yet declared.
 */
type UndeclaredDrawerCallback = { bivarianceHack(...args: unknown[]): unknown }["bivarianceHack"];

/** The callbacks of a drawer no map declares yet. */
export type UndeclaredDrawerCallbacks = Record<string, UndeclaredDrawerCallback | undefined>;

/** Only the callback (function) props of a drawer's props. */
export type DrawerCallbacksIn<Props> = {
  [
    K in keyof Props as Props[K] extends ((...args: never[]) => unknown) | undefined ? K : never
  ]?: Props[K];
};

/** Every drawer's flow callbacks, by name. */
export type UiFlowCallbacksStore = Record<string, UndeclaredDrawerCallbacks | undefined>;
