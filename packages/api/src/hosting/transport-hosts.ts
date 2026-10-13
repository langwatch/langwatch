/**
 * The seam a process's doors are handed through, so a feature's declared
 * transports mount themselves at boot. Types are erased on purpose: this file
 * knows nothing of Hono or tRPC.
 */
import type { DependencyToken } from "@langwatch/module";

/** One declared family or namespace, as a host reads it back. */
export type MountableTransport = object;

/**
 * One thing a module bound for its own doors (a credential, its API door or a middleware
 * context), as the doors carry it. The shape is erased here on purpose: what each is and
 * how it resolves belongs to the transport toolkit, and this file knows neither.
 */
export type MiddlewareBinding = object;

/** What one install states beyond the declaration, as a REST host reads it. */
export type FeatureRestMountOptions = Readonly<{
  /** What the module bound for the declaration's routes. */
  middlewareBindings?: readonly MiddlewareBinding[];
}>;

/** What one install states beyond the declaration, as a tRPC host reads it. */
export type FeatureTrpcMountOptions = Readonly<{
  /** What the module bound for the declaration's procedures. */
  middlewareBindings?: readonly MiddlewareBinding[];
}>;

/** A process's REST door, as the installer calls it. */
export interface FeatureRestHost<Mounted> {
  mount(
    declaration: MountableTransport,
    app: () => unknown,
    options?: FeatureRestMountOptions,
  ): Mounted;
}

/** A process's tRPC root, as the installer calls it. */
export interface FeatureTrpcHost<Mounted> {
  mount(
    declaration: MountableTransport,
    app: () => unknown,
    options?: FeatureTrpcMountOptions,
  ): Mounted;
}

/** What one installed module bound for the doors, by the module's name. */
export type BoundMiddlewareBindings = Readonly<{
  feature: string;
  middlewareBindings: readonly MiddlewareBinding[];
}>;

/** One module's App this build installed, reached by its contract token. */
export interface TransportPeers {
  /**
   * The App behind one contract token. A token this build installed no module
   * for is a wiring bug in the process's own door table, so it is refused by
   * token name rather than answered with a door that resolves nobody.
   */
  app<Instance>(token: DependencyToken<Instance>): Instance;
  /**
   * The same, answering nothing where this build installed no such module.
   * Only a door a deployment may legitimately run without asks this way.
   */
  find<Instance>(token: DependencyToken<Instance>): Instance | undefined;
  /** Every installed module's bindings, for the door the process opens before its hosts. */
  readonly middlewareBindings: readonly BoundMiddlewareBindings[];
}
