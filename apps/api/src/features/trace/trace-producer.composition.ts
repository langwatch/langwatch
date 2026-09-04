/**
 * The trace-side commands this process PRODUCES, composed once.
 *
 * Three senders come off ONE registration of the packaged `trace_processing`
 * pipeline, because a pipeline may only be registered once — a second
 * `register` of the same definition re-declares its aggregate and its event
 * catalogue. So the process registers here and hands the senders to everything
 * that writes on the lane: a reviewer's comment marker, the reserved-metadata
 * amendment's synthetic span, and the raw span an agent test writes.
 *
 * Registered PRODUCER-only: this process starts no consumer loop and folds
 * nothing. Registering the packaged definition rather than a local one is what
 * keeps the routing triple every job carries identical to the one the worker
 * routes on — two descriptions of one event stream drift into jobs nothing can
 * pick up.
 */
import type { EventSourcing } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import { createTraceProcessingProducerPipeline } from "@langwatch/trace-server";

/** The marker a comment leaves on the trace it was left on. */
export type TraceAnnotationMarker = Readonly<{
  tenantId: string;
  traceId: string;
  annotationId: string;
  occurredAt: number;
}>;

/** What a process can send on the `trace_processing` pipeline it produces to. */
export type ApiTraceProducerCommands = Readonly<{
  add(input: TraceAnnotationMarker): Promise<void>;
  remove(input: TraceAnnotationMarker): Promise<void>;
  /** One raw OTLP span, as the collector enqueues them. */
  recordSpan(input: unknown): Promise<void>;
}>;

/**
 * Registers the pipeline and publishes its senders, or refuses by name where
 * this process composed no command queue.
 *
 * The refusal is not a resolved promise: every caller treats the write as best
 * effort, and best effort is about tolerating a failure, not about hiding one.
 */
export function composeApiTraceProducerCommands(options: {
  eventing: EventSourcing | undefined;
  /** Names a producer-only refusal, so a stand-in says which process reached it. */
  processName: string;
}): ApiTraceProducerCommands {
  if (!options.eventing) {
    const refuse = (): Promise<never> =>
      Promise.reject(
        new ApiTraceProducerUnavailableError(
          "command queue, so it cannot write on the trace pipeline",
        ),
      );
    return { add: refuse, remove: refuse, recordSpan: refuse };
  }

  const registered = options.eventing.register(
    createTraceProcessingProducerPipeline({ processName: options.processName }),
  );
  const commands = registered.commands as Record<string, unknown>;
  const add = commands.addAnnotation;
  const remove = commands.removeAnnotation;
  const recordSpan = commands.recordSpan;
  if (!isSender(add) || !isSender(remove) || !isSender(recordSpan)) {
    throw new Error(
      'The trace_processing registration produced no "addAnnotation", "removeAnnotation" and "recordSpan" command senders; the pipeline was registered incompletely.',
    );
  }
  return {
    add: async (input) => {
      await add.send(input);
    },
    remove: async (input) => {
      await remove.send(input);
    },
    recordSpan: async (input) => {
      await recordSpan.send(input);
    },
  };
}

/** The one shape a command dispatcher has, checked rather than asserted. */
type CommandSender = { send(data: unknown): Promise<unknown> };
const isSender = (value: unknown): value is CommandSender =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as CommandSender).send === "function";

/** A capability this deployment did not compose, refused by name. */
class ApiTraceProducerUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiTraceProducerUnavailableError";
  }
}
