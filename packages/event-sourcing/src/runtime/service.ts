import { ConfigurationError } from "../errors";
import { contentHash } from "../pipeline/contentHash";
import type { BuiltPipeline } from "../pipeline/pipeline.types";
import type {
  CommandClient,
  CommittedEvent,
  EnginePorts,
  EventProducer,
  EventSourcingService,
  HandlerContext,
  Lane,
  LaneConsumer,
  Registry,
  ReplayReport,
  ReplayRequest,
} from "./contracts";
import { createRegistry } from "./registry";

/**
 * The service (ADR-108 decision 1): lifecycle only — register, start, stop,
 * replay. `replay` and the lane consumer are collaborators a sibling package
 * implements against these same contracts; they arrive here as optional
 * constructor arguments so a test can hand in a fake and production can hand
 * in the real thing without this file changing.
 */

export interface EventSourcingServiceDeps {
  readonly ports: EnginePorts;
  /** Defaults to a fresh {@link createRegistry}. A caller that needs to bind a
   * command port before every pipeline has registered (ADR-108 §13's
   * cross-pipeline bridge) constructs its own registry, binds on it directly,
   * and passes that same instance in here — binding is a registry concern,
   * not a lifecycle one, so the service does not expose it separately. */
  readonly registry?: Registry;
  /** Appends and stages a command's emitted events. Absent only in a test or
   * a bootstrap: {@link createCommandClient} falls back to `ports.eventLog`
   * directly, which appends but never stages a lane job. */
  readonly producer?: EventProducer;
  readonly consumer?: LaneConsumer;
  readonly replay?: (request: ReplayRequest) => Promise<ReplayReport>;
}

/** A non-cryptographic, dependency-free unique id. Good enough to key a
 * committed event row; a sibling may swap in a real generator later without
 * changing `CommittedEvent`'s shape. */
function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * ADR-107 decision 4: a pipeline of maps alone is never asked for an `.id()`,
 * because a map's row carries its own key and needs no mutual exclusion. Such a
 * pipeline has no extractor to call, so each distinct payload is its own
 * aggregate. Only a
 * fold or a process manager makes the id load-bearing, and neither can be
 * mounted without `.id()`, so this can never mask a missing extractor on a
 * pipeline that actually accumulates.
 */
function aggregateIdOf(
  pipeline: BuiltPipeline,
  event: { readonly type: string; readonly data: unknown },
  payloadHash: string,
): string {
  const accumulates =
    Object.keys(pipeline.folds).length > 0 ||
    Object.keys(pipeline.processManagers).length > 0;
  // Derived from the payload, not from a fresh id: the aggregate id is part of
  // `event_log`'s sort key, so a random one per attempt would stop a retried
  // command collapsing onto its own row and append a duplicate instead.
  if (!accumulates) return payloadHash;
  return pipeline.aggregateIdFor(event.type, event.data);
}

function toCommittedEvent(args: {
  readonly pipeline: BuiltPipeline;
  readonly commandName: string;
  readonly tenantId: string;
  readonly occurredAt: number;
  readonly index: number;
  readonly event: { readonly type: string; readonly data: unknown };
}): CommittedEvent {
  const eventId = randomId();
  // Encoded once here and reused for the hash and the row (ADR-108 §7).
  const payload = JSON.stringify(args.event.data);
  const payloadHash = contentHash(payload);
  return {
    tenantId: args.tenantId,
    aggregateType: args.pipeline.name,
    aggregateId: aggregateIdOf(args.pipeline, args.event, payloadHash),
    eventId,
    eventType: args.event.type,
    // Events carry no version concept of their own in the frozen contract
    // (only a fold's state does) — "1" until one is introduced.
    eventVersion: "1",
    // Deterministic in the command's own input, so a retry collapses onto the
    // same row instead of minting a sibling (ADR-107 decision 15). The payload
    // is HASHED, never embedded: this value is part of `event_log`'s sort key,
    // so carrying the payload itself would put megabytes into the primary index
    // of the highest-volume table in the system.
    idempotencyKey: `${args.commandName}#${args.index}#${payloadHash}`,
    occurredAt: args.occurredAt,
    payload,
  };
}

function createCommandClient(args: {
  readonly registry: Registry;
  readonly ports: EnginePorts;
  readonly producer: EventProducer | undefined;
}): CommandClient {
  return {
    async send(name, input, ctx) {
      const found = args.registry.findCommand(name);
      if (!found) {
        throw new ConfigurationError(
          `no registered pipeline owns command "${name}"`,
          {
            command: name,
            registered: args.registry.commandNames(),
          },
        );
      }
      const command = found.pipeline.commands[found.command];
      if (!command) {
        throw new ConfigurationError(
          `command "${name}" resolved to a pipeline that no longer mounts it`,
          { command: name, pipeline: found.pipeline.name },
        );
      }
      const now = args.ports.clock.now();
      const handlerCtx: HandlerContext = { now, tenantId: ctx.tenantId };
      const emitted = await command.handle(input, handlerCtx);
      const events = emitted.map((event, index) =>
        toCommittedEvent({
          pipeline: found.pipeline,
          commandName: name,
          tenantId: ctx.tenantId,
          occurredAt: now,
          index,
          event,
        }),
      );
      if (events.length > 0) {
        if (args.producer) await args.producer.publish(events);
        else await args.ports.eventLog.append(events);
      }
      return { events };
    },
  };
}

/** The `enabled(lane)` predicate a consumer consults before claiming
 * (ADR-108 decision 13). Defaults true when the ports supply none. */
function resolveEnabled(ports: EnginePorts): (lane: Lane) => boolean {
  return ports.enabled ?? (() => true);
}

export function createEventSourcingService(
  deps: EventSourcingServiceDeps,
): EventSourcingService & { enabled(lane: Lane): boolean } {
  const registry = deps.registry ?? createRegistry();
  const commands = createCommandClient({
    registry,
    ports: deps.ports,
    producer: deps.producer,
  });
  const enabled = resolveEnabled(deps.ports);
  let consumerRunning = false;

  return {
    register(pipeline) {
      registry.register(pipeline);
    },

    commands,

    enabled,

    async start({ runsConsumers }) {
      // Registration is unconditional; this is the one gate on consumption
      // (ADR-110 decision 6). Checked before anything else is touched, so an
      // unresolvable command port fails a deploy rather than a customer's
      // dispatch.
      registry.assertResolvable();
      if (runsConsumers && !consumerRunning && deps.consumer) {
        deps.consumer.start();
        consumerRunning = true;
      }
    },

    async stop() {
      if (!consumerRunning || !deps.consumer) return;
      await deps.consumer.stop();
      consumerRunning = false;
    },

    async replay(request) {
      if (!deps.replay) {
        throw new ConfigurationError(
          "replay was not wired into this service",
          {},
        );
      }
      return deps.replay(request);
    },
  };
}
