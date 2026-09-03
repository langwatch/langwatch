/**
 * The three agent-side pipelines this process PRODUCES commands on.
 *
 *   simulation_processing         a scenario run's eight writes
 *   suite_run_processing          a suite run's start
 *   langy_conversation_processing a conversation's sixteen writes
 *
 * ## Why this file exists
 *
 * A scenario run and a Langy turn are the two places a customer's action turns
 * into durable work, and until this composition landed both refused with
 * `service_unavailable` on the API. The reason was one fact, and it was a
 * framework limitation rather than a deployment one: each of those two
 * definitions declares a PROCESS MANAGER, and the Eventing runtime refused to
 * register any pipeline declaring one unless the process also held a durable
 * `ProcessStore`. A web process holds none — a process manager's inbox, outbox
 * and wakes are the worker's work — so ONE declaration inside a definition made
 * every command on it unsendable from the tier the action actually arrives at.
 *
 * `EventSourcingOptions.processManagerMode: "producer-only"` separates the two
 * jobs. The producer registers the definition WHOLE — every command dispatcher,
 * every routing key — and the runtime declines to RUN the process managers, by
 * name, once at boot. Producing and running were never the same decision.
 *
 * ## One definition, two registrations
 *
 * Each pipeline is built here from its feature's own producer variant
 * (`createSimulationProcessingProducerPipeline` and friends), which supplies
 * stand-ins for the consumer-side dependencies so the definition can be
 * CONSTRUCTED, and refuses by name if one is ever CALLED. That is the same
 * shape `createTraceProcessingProducerPipeline` and
 * `createEvaluationProcessingProducerPipeline` already have on this process.
 *
 * Registering the packaged definition rather than a local one is what keeps the
 * routing triple every job carries identical to the one the worker routes on.
 * Two descriptions of one event stream drift into jobs nothing can pick up, and
 * the queue rejects an unroutable job for redelivery rather than dropping it —
 * so a fork here is a queue that grows forever while the pods stay up.
 *
 * ## What is still absent
 *
 * The run EXECUTOR is not a command and is not composed here: submitting a
 * scenario run to a pool and resolving its target reach ten other verticals,
 * and `api-trpc-collaborators.agent-group.composition.ts` still refuses those by
 * name. Same for the Langy AGENT MANAGER: starting a turn dispatches to it over
 * HTTP, and a process with no `LANGY_*` configuration has none. Those are
 * deployment absences, which is exactly what this file's absence is NOT.
 */
import type { EventSourcing } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import {
  createLangyConversationProducerPipeline,
  type LangyConversationCommands,
} from "@langwatch/langy-server";
import {
  createSimulationProcessingProducerPipeline,
  SimulationExecutionPort,
} from "@langwatch/scenario-server";
import type {
  SimulationCancelRun,
  SimulationDeleteRun,
  SimulationFinishRun,
  SimulationMessageSnapshot,
  SimulationQueueRun,
  SimulationStartRun,
  SimulationTextMessageEnd,
  SimulationTextMessageStart,
} from "@langwatch/scenario-contract";
import {
  createSuiteRunProcessingProducerPipeline,
  SuiteRunCommandsPort,
  type QueueSimulationRunCommandData,
  type StartSuiteRunCommandData,
} from "@langwatch/suite-server";

/**
 * A write this deployment cannot enqueue, refused by name.
 *
 * The same `service_unavailable` the agent-group half answers with — the code
 * is what the client presentation registry is keyed by — declared here so this
 * module composes without reaching back into the half that consumes it.
 */
class ApiAgentPipelineUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiAgentPipelineUnavailableError";
  }
}

/** Reports the composition decision an absent queue would otherwise hide. */
export abstract class ApiAgentPipelinesAbsenceReport {
  /** No Eventing: every agent-side write refuses rather than queuing nothing. */
  abstract withoutQueue(): void;
}

export type ApiAgentPipelinesOptions = Readonly<{
  /**
   * The producer-only eventing runtime the three definitions are registered
   * on, or `undefined` where this process composed no queue.
   */
  eventing: EventSourcing | undefined;
  /** Names this process in a producer stand-in's refusal. */
  processName: string;
  report?: ApiAgentPipelinesAbsenceReport;
}>;

/** The agent-side write surfaces, as this process produces them. */
export type ApiAgentPipelines = Readonly<{
  /** The eight simulation writes, as the scenario application dispatches them. */
  simulations: SimulationExecutionPort;
  /** The two writes a suite run is started and fanned out by. */
  suiteRuns: SuiteRunCommandsPort;
  /** All sixteen conversation writes. */
  langyConversations: LangyConversationCommands;
}>;

/**
 * Registers the three definitions producer-only and publishes their senders.
 *
 * With no Eventing every surface refuses BY NAME rather than resolving: a
 * swallowed `queueRun` is a run that never starts while the page says it did,
 * and a swallowed `recordMessage` is a message a customer watched themselves
 * send and will never see again.
 */
export function composeApiAgentPipelines(options: ApiAgentPipelinesOptions): ApiAgentPipelines {
  const { eventing, processName } = options;
  if (!eventing) {
    options.report?.withoutQueue();
    return {
      simulations: new UnqueuedApiSimulationExecution(),
      suiteRuns: new UnqueuedApiSuiteRunCommands(),
      langyConversations: unqueuedLangyConversationCommands(),
    };
  }

  const simulation = commandLookup({
    pipeline: "simulation_processing",
    registered: eventing.register(createSimulationProcessingProducerPipeline({ processName })),
  });
  const suite = commandLookup({
    pipeline: "suite_run_processing",
    registered: eventing.register(createSuiteRunProcessingProducerPipeline({ processName })),
  });
  const langy = commandLookup({
    pipeline: "langy_conversation_processing",
    registered: eventing.register(createLangyConversationProducerPipeline({ processName })),
  });

  return {
    simulations: new EventingApiSimulationExecution(simulation),
    // `queueSimulationRun` is the SIMULATION pipeline's `queueRun`, not a suite
    // command: a suite run fans out into one simulation run per case, and both
    // tiers have always written those onto the simulation stream. Only
    // `startSuiteRun` belongs to the suite pipeline.
    suiteRuns: new EventingApiSuiteRunCommands(suite("startSuiteRun"), simulation("queueRun")),
    langyConversations: langyConversationCommands(langy),
  };
}

/** The one shape a command dispatcher has, checked rather than asserted. */
type CommandSender = { send(data: unknown): Promise<unknown> };

const isSender = (value: unknown): value is CommandSender =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as CommandSender).send === "function";

/** One dispatch, as every sender below is called. */
type Dispatch = (data: unknown) => Promise<void>;

/**
 * Reads one registration's senders, FAILING AT BOOT for a command it did not
 * produce.
 *
 * Naming the missing command at boot rather than at the first dispatch is the
 * whole reason this is a function: an incompletely registered pipeline is a
 * composition error, and finding it when a customer presses the button means
 * finding it in their session.
 */
function commandLookup(input: {
  pipeline: string;
  registered: { commands: unknown };
}): (name: string) => Dispatch {
  const commands = input.registered.commands as Record<string, unknown>;
  return (name: string): Dispatch => {
    const sender = commands[name];
    if (!isSender(sender)) {
      throw new Error(
        `The ${input.pipeline} registration produced no "${name}" command sender; the pipeline was registered incompletely.`,
      );
    }
    return async (data: unknown) => {
      await sender.send(data);
    };
  };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/** The eight simulation writes, on this process's own registration. */
class EventingApiSimulationExecution extends SimulationExecutionPort {
  private readonly dispatch: Record<string, Dispatch>;

  constructor(command: (name: string) => Dispatch) {
    super();
    this.dispatch = Object.fromEntries(
      SIMULATION_COMMAND_NAMES.map((name) => [name, command(name)]),
    );
  }

  queueRun(input: SimulationQueueRun): Promise<void> {
    return this.send("queueRun", input);
  }
  startRun(input: SimulationStartRun): Promise<void> {
    return this.send("startRun", input);
  }
  messageSnapshot(input: SimulationMessageSnapshot): Promise<void> {
    return this.send("messageSnapshot", input);
  }
  textMessageStart(input: SimulationTextMessageStart): Promise<void> {
    return this.send("textMessageStart", input);
  }
  textMessageEnd(input: SimulationTextMessageEnd): Promise<void> {
    return this.send("textMessageEnd", input);
  }
  finishRun(input: SimulationFinishRun): Promise<void> {
    return this.send("finishRun", input);
  }
  cancelRun(input: SimulationCancelRun): Promise<void> {
    return this.send("cancelRun", input);
  }
  deleteRun(input: SimulationDeleteRun): Promise<void> {
    return this.send("deleteRun", input);
  }

  private send(name: string, input: unknown): Promise<void> {
    // Resolved at construction, so this cannot be absent; the lookup that
    // built it is what refuses an incomplete registration, at boot.
    return this.dispatch[name]!(input);
  }
}

/**
 * The eight names, listed once.
 *
 * `computeRunMetrics` is deliberately not here: it is dispatched by the
 * pipeline's OWN subscriber when a run finishes, never by a customer's action,
 * so a producer that published it would be offering a write nothing on this
 * tier has a reason to make.
 */
const SIMULATION_COMMAND_NAMES = [
  "queueRun",
  "startRun",
  "messageSnapshot",
  "textMessageStart",
  "textMessageEnd",
  "finishRun",
  "cancelRun",
  "deleteRun",
] as const;

/** The eight simulation writes, refused by name where there is no queue. */
class UnqueuedApiSimulationExecution extends SimulationExecutionPort {
  queueRun(): Promise<void> {
    return this.refuse();
  }
  startRun(): Promise<void> {
    return this.refuse();
  }
  messageSnapshot(): Promise<void> {
    return this.refuse();
  }
  textMessageStart(): Promise<void> {
    return this.refuse();
  }
  textMessageEnd(): Promise<void> {
    return this.refuse();
  }
  finishRun(): Promise<void> {
    return this.refuse();
  }
  cancelRun(): Promise<void> {
    return this.refuse();
  }
  deleteRun(): Promise<void> {
    return this.refuse();
  }

  private refuse(): Promise<never> {
    return Promise.reject(new ApiAgentPipelineUnavailableError("Running a simulation"));
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

/** A suite run's start, and the simulation run each of its cases becomes. */
class EventingApiSuiteRunCommands extends SuiteRunCommandsPort {
  constructor(
    private readonly startSuiteRunCommand: Dispatch,
    private readonly queueSimulationRunCommand: Dispatch,
  ) {
    super();
  }

  startSuiteRun(data: StartSuiteRunCommandData): Promise<void> {
    return this.startSuiteRunCommand(data);
  }

  queueSimulationRun(data: QueueSimulationRunCommandData): Promise<void> {
    return this.queueSimulationRunCommand(data);
  }
}

/** Both suite writes, refused by name where there is no queue. */
class UnqueuedApiSuiteRunCommands extends SuiteRunCommandsPort {
  startSuiteRun(): Promise<void> {
    return Promise.reject(new ApiAgentPipelineUnavailableError("Running a suite"));
  }
  queueSimulationRun(): Promise<void> {
    return Promise.reject(new ApiAgentPipelineUnavailableError("Running a suite"));
  }
}

// ---------------------------------------------------------------------------
// Langy
// ---------------------------------------------------------------------------

/**
 * All sixteen conversation commands, built from ONE list.
 *
 * A list rather than sixteen literals so a command added to the pipeline cannot
 * silently acquire a different wiring from its fifteen siblings — and so a
 * command REMOVED from the pipeline fails this process's boot rather than one
 * customer's message.
 */
const LANGY_COMMAND_NAMES = [
  "createConversation",
  "forkConversation",
  "recordMessage",
  "importMessage",
  "acceptAgentTurn",
  "initiateToolCall",
  "succeedToolCall",
  "failToolCall",
  "updatePlan",
  "failAgentResponse",
  "recordAgentResponse",
  "archiveConversation",
  "updateConversationMetadata",
  "recordTurnHandoff",
  "consumeTurnHandoff",
  "generateConversationTitle",
] as const satisfies ReadonlyArray<keyof LangyConversationCommands>;

function langyConversationCommands(command: (name: string) => Dispatch): LangyConversationCommands {
  return Object.fromEntries(
    LANGY_COMMAND_NAMES.map((name) => [name, command(name)]),
  ) as unknown as LangyConversationCommands;
}

function unqueuedLangyConversationCommands(): LangyConversationCommands {
  const refuse = (): Promise<never> =>
    Promise.reject(new ApiAgentPipelineUnavailableError("Writing to a Langy conversation"));

  return Object.fromEntries(
    LANGY_COMMAND_NAMES.map((name) => [name, refuse]),
  ) as unknown as LangyConversationCommands;
}
