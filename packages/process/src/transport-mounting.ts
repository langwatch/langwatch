/**
 * The seam a process's own doors are handed through, so a feature's declared
 * transports mount themselves at boot. Types are erased on purpose: this
 * package knows nothing of Hono or tRPC.
 */
import type {
  FeatureRestHost,
  FeatureTrpcHost,
  MountableTransport,
  TransportFactBinding,
} from "@langwatch/api";

import type { FeatureTransportDescriptor } from "./feature-installer.ts";

/** A process's upgrade router, as the installer calls it. */
export interface FeatureWebSocketHost {
  mount(declaration: MountableTransport, app: () => unknown): void;
}

/** The role's own port for sockets handed on unopened, as the installer calls it. */
export interface FeatureRawSocketHost {
  mount(declaration: MountableTransport, app: () => unknown): void;
}

/** The api process's doors answered ahead of its routes, as the installer calls them. */
export interface FeatureRawHttpHost {
  mount(declaration: MountableTransport, app: () => unknown): void;
}

/** The doors one process opens, named by protocol. */
export type FeatureTransportHosts<Rest, Trpc> = Readonly<{
  rest?: FeatureRestHost<Rest> | undefined;
  trpc?: FeatureTrpcHost<Trpc> | undefined;
  websocket?: FeatureWebSocketHost | undefined;
  rawsocket?: FeatureRawSocketHost | undefined;
  rawhttp?: FeatureRawHttpHost | undefined;
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
      if (mountedAsDoor(entry, descriptor, hosts)) continue;
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

/** Mounts a socket or raw door, whose host keeps no record; false for REST and tRPC. */
function mountedAsDoor<Rest, Trpc>(
  entry: DeclaredTransports,
  descriptor: FeatureTransportDescriptor,
  hosts: FeatureTransportHosts<Rest, Trpc>,
): boolean {
  if (descriptor.protocol === "websocket") mountSocket(entry, descriptor, hosts.websocket);
  else if (descriptor.protocol === "rawsocket") mountRawSocket(entry, descriptor, hosts.rawsocket);
  else if (descriptor.protocol === "rawhttp") mountRawHttp(entry, descriptor, hosts.rawhttp);
  else return false;
  return true;
}

/** One socket on the process's upgrade router, bound to the feature's app. */
function mountSocket(
  entry: DeclaredTransports,
  descriptor: FeatureTransportDescriptor,
  host: FeatureWebSocketHost | undefined,
): void {
  if (!host) throw new MissingTransportHostError(entry.feature, "WebSocket");
  host.mount(descriptor.router(), entry.provided);
}

/** One raw-socket door on the role's own port, bound to the feature's app. */
function mountRawSocket(
  entry: DeclaredTransports,
  descriptor: FeatureTransportDescriptor,
  host: FeatureRawSocketHost | undefined,
): void {
  if (!host) throw new MissingTransportHostError(entry.feature, "raw socket");
  host.mount(descriptor.router(), entry.provided);
}

/** One raw HTTP door on the api process's own listener, bound to the feature's app. */
function mountRawHttp(
  entry: DeclaredTransports,
  descriptor: FeatureTransportDescriptor,
  host: FeatureRawHttpHost | undefined,
): void {
  if (!host) throw new MissingTransportHostError(entry.feature, "raw HTTP");
  host.mount(descriptor.router(), entry.provided);
}

/**
 * The declarations one role mounts: the api role hosts every door but the raw
 * socket, which the role that owns the scenario children hosts (record §8).
 */
export function declaredForRole(
  declared: readonly DeclaredTransports[],
  role: "api" | "worker",
): DeclaredTransports[] {
  return declared.map((entry) => ({
    ...entry,
    transports: entry.transports.filter((descriptor) =>
      role === "worker" ? descriptor.protocol === "rawsocket" : descriptor.protocol !== "rawsocket",
    ),
  }));
}

/** One REST family on the process's own door, with the family's own options. */
function mountRest<Rest>(
  entry: DeclaredTransports,
  descriptor: FeatureTransportDescriptor,
  host: FeatureRestHost<Rest> | undefined,
): Rest {
  if (!host) throw new MissingTransportHostError(entry.feature, "REST");

  // A module binds ONE facts list for both doors; each door takes only its
  // own shape (REST bindings carry `middleware`, tRPC bindings carry `fact`).
  const facts = entry.facts.filter((binding) => "middleware" in binding || "credential" in binding);
  return host.mount(descriptor.router(), entry.provided, facts.length > 0 ? { facts } : {});
}

/** One tRPC namespace on the process's own root, bound to the feature's app. */
function mountTrpc<Trpc>(
  entry: DeclaredTransports,
  descriptor: FeatureTransportDescriptor,
  host: FeatureTrpcHost<Trpc> | undefined,
): Trpc {
  if (!host) throw new MissingTransportHostError(entry.feature, "tRPC");

  const facts = entry.facts.filter((binding) => "fact" in binding);
  const options = facts.length > 0 ? { facts } : {};

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
