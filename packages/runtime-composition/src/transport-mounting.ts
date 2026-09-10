/**
 * The seam a process's own doors are handed through, so a feature's declared
 * transports mount themselves at boot. Types are erased on purpose: this
 * package knows nothing of Hono or tRPC.
 */
import type { FeatureTransportDescriptor } from "./feature-installer.ts";

/** One declared family or namespace, as a host reads it back. */
export type MountableTransport = object;

/**
 * One value a module bound for a fact its own routes declare, as the doors
 * carry it. The shape is erased here on purpose: what a fact is and how it
 * resolves belongs to the transport toolkit, and this package knows neither.
 */
export type TransportFactBinding = object;

/** What one install states beyond the declaration, as a REST host reads it. */
export type FeatureRestMountOptions = Readonly<{
  /** One binding per module-specific fact the declaration's routes name. */
  facts?: readonly TransportFactBinding[];
}>;

/** What one install states beyond the declaration, as a tRPC host reads it. */
export type FeatureTrpcMountOptions = Readonly<{
  /** One binding per module-specific fact the declaration's procedures name. */
  facts?: readonly TransportFactBinding[];
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

/** The doors one process opens, named by protocol. */
export type FeatureTransportHosts<Rest, Trpc> = Readonly<{
  rest?: FeatureRestHost<Rest> | undefined;
  trpc?: FeatureTrpcHost<Trpc> | undefined;
}>;

/** Whatever the process's doors made of one feature's declared transports. */
export type MountedTransports<Rest, Trpc> = Readonly<{
  /** Every REST family, in the order the features were installed. */
  rest: readonly Rest[];
  /** Every tRPC namespace, by the name its declaration carries. */
  trpc: Readonly<Record<string, Trpc>>;
}>;

/**
 * A feature declares a transport for a protocol this process opened no door
 * for. Refused at boot, by feature and protocol, rather than serving a graph
 * whose declared surface is silently half absent.
 */
export class MissingTransportHostError extends Error {
  constructor(
    readonly feature: string,
    readonly protocol: string,
  ) {
    super(
      `Feature "${feature}" declares a ${protocol} transport, and this application was ` +
        `given no ${protocol} runtime to mount it on.`,
    );
    this.name = "MissingTransportHostError";
  }
}

/** Two installed features claim one tRPC namespace, so neither could answer. */
export class DuplicateTransportNamespaceError extends Error {
  constructor(
    readonly namespace: string,
    readonly features: readonly string[],
  ) {
    super(`tRPC namespace "${namespace}" is declared by: ${features.join(", ")}.`);
    this.name = "DuplicateTransportNamespaceError";
  }
}

/** What one feature contributed to the process's doors, before mounting. */
export type DeclaredTransports = Readonly<{
  feature: string;
  transports: readonly FeatureTransportDescriptor[];
  provided: () => unknown;
  /** What the module itself bound for the facts its declarations name. */
  facts: readonly TransportFactBinding[];
}>;

/**
 * Mounts every declared transport on the doors the process opened. Called once
 * boot has constructed each application, so the app a handler reaches is the
 * same instance every other caller of that feature holds.
 */
export function mountDeclaredTransports<Rest, Trpc>({
  declared,
  hosts,
}: {
  declared: readonly DeclaredTransports[];
  hosts: FeatureTransportHosts<Rest, Trpc>;
}): MountedTransports<Rest, Trpc> {
  const rest: Rest[] = [];
  const trpc: Record<string, Trpc> = {};
  const owners = new Map<string, string>();

  for (const entry of declared) {
    for (const descriptor of entry.transports) {
      if (descriptor.protocol === "rest") {
        rest.push(mountRest(entry, descriptor, hosts.rest));
        continue;
      }

      const namespace = namespaceOf(descriptor, entry.feature);
      const owner = owners.get(namespace);

      if (owner !== undefined) {
        throw new DuplicateTransportNamespaceError(namespace, [owner, entry.feature]);
      }

      owners.set(namespace, entry.feature);
      trpc[namespace] = mountTrpc(entry, descriptor, hosts.trpc);
    }
  }

  return { rest, trpc };
}

/** One REST family on the process's own door, with the family's own options. */
function mountRest<Rest>(
  entry: DeclaredTransports,
  descriptor: FeatureTransportDescriptor,
  host: FeatureRestHost<Rest> | undefined,
): Rest {
  if (!host) throw new MissingTransportHostError(entry.feature, "REST");

  return host.mount(descriptor.router(), entry.provided, {
    ...(entry.facts.length > 0 ? { facts: entry.facts } : {}),
  });
}

/** One tRPC namespace on the process's own root, bound to the feature's app. */
function mountTrpc<Trpc>(
  entry: DeclaredTransports,
  descriptor: FeatureTransportDescriptor,
  host: FeatureTrpcHost<Trpc> | undefined,
): Trpc {
  if (!host) throw new MissingTransportHostError(entry.feature, "tRPC");

  const options = entry.facts.length > 0 ? { facts: entry.facts } : {};

  return host.mount(descriptor, entry.provided, options);
}

/** The wire name a tRPC declaration carries, or the wiring bug that it carries none. */
function namespaceOf(descriptor: FeatureTransportDescriptor, feature: string): string {
  const namespace = descriptor.namespace;

  if (typeof namespace !== "string" || namespace.length === 0) {
    throw new Error(`Feature "${feature}" declares a tRPC transport with no namespace.`);
  }

  return namespace;
}
