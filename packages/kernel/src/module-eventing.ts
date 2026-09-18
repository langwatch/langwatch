/**
 * The seam between a module and the event-sourced half of a process (ADR-144).
 * Composition names no pipeline, projection or subscriber, keeping
 * `@langwatch/eventing` and the Prisma/ioredis/ClickHouse graph off this package.
 */
import type { ServerRole } from "./feature-installer.ts";

/**
 * Whether this process only sends on a pipeline, or also drains it. The api
 * produces; the worker folds, maps, subscribes and runs process managers —
 * the one branch a declaration reading its own projections is allowed to take.
 */
export type EventingParticipation = "produce" | "consume";

/**
 * Which half the role runs. The worker is the one role that drains: it claims
 * the shared job queue, so every other role sends and drains nothing. No main
 * states this — a process that must differ says so on its own member.
 */
export function participationForRole(role: ServerRole): EventingParticipation {
  return role === "worker" ? "consume" : "produce";
}

/** What a module's eventing declaration is handed when a process installs it. */
export interface FeatureEventingSetup<Repositories, App, ProcessStore> {
  readonly participation: EventingParticipation;
  /** The module's own repositories, on the backend this process selected. */
  readonly repositories: Repositories;
  /** The module's app, already constructed. */
  readonly app: App;
  /** The process state this graph leases and prunes. Another graph's store
   * would prune another process's outbox rows. */
  readonly processStore: ProcessStore;
}

/** What a registered pipeline answers with, as composition reads it back. */
export interface FeatureEventingRegistration {
  readonly commands?: Readonly<Record<string, unknown>>;
}

/**
 * A module's eventing declaration, with its pipeline's own types erased.
 * `Repositories` and `App` are the module's, so a declaration written against
 * another module's app is not assignable where `.withEventing` takes it.
 */
export interface FeatureEventing<
  Repositories = unknown,
  App = unknown,
  ProcessStore = unknown,
  Definition = unknown,
> {
  /** The pipeline's name, so a refusal names it without building anything. */
  readonly pipeline: string;
  build(setup: FeatureEventingSetup<Repositories, App, ProcessStore>): Definition;
  /** What the module does with the senders registration answered with. */
  connect?(bound: Readonly<{ app: App; commands: Readonly<Record<string, unknown>> }>): void;
}

/**
 * As much of an eventing runtime as installing one module's pipeline needs. A
 * process that runs event sourcing puts one on its pool under `eventing`; a
 * role that does not puts nothing there, and declarations are ignored.
 */
export interface EventingHost {
  readonly participation: EventingParticipation;
  readonly processStore: unknown;
  register(definition: unknown): unknown;
}

/**
 * The eventing runtime a process holds, or nothing. Read by name, the way a
 * repository tier reads `prisma`, so a process running none ignores every
 * declaration. Participation follows the role unless the member states its own.
 */
export function eventingHostFrom(pool: unknown, role: ServerRole): EventingHost | undefined {
  if (typeof pool !== "object" || pool === null) return void 0;
  const candidate = (pool as Readonly<Record<string, unknown>>).eventing;
  if (typeof candidate !== "object" || candidate === null) return void 0;
  const host = candidate as Partial<EventingHost>;
  if (typeof host.register !== "function") return void 0;
  const stated = host.participation;
  return {
    participation:
      stated === "produce" || stated === "consume" ? stated : participationForRole(role),
    processStore: host.processStore,
    register: host.register.bind(candidate),
  };
}

/** What `register` answered, read back without asserting a shape it may not have. */
export function commandsOf(registration: unknown): Readonly<Record<string, unknown>> {
  if (typeof registration !== "object" || registration === null) return {};
  const commands = (registration as FeatureEventingRegistration).commands;
  if (typeof commands !== "object" || commands === null) return {};
  return commands;
}
