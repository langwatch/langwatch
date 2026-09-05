/**
 * The three agent-side pipelines this process PRODUCES commands on. simulation_processing
 * a scenario run's eight writes suite_run_processing          a suite run's start
 * langy_conversation_processing a conversation's sixteen writes A scenario run and a
 */
import type { EventSourcing } from "@langwatch/eventing";
import type { Logger } from "@langwatch/observability";
import { HandledError } from "@langwatch/handled-error";
import {
  LangyConversationProducerAdapter,
  type LangyConversationCommands,
} from "@langwatch/langy-server";
import {
  SimulationProcessingProducerAdapter,
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
  SuiteRunCommandsPort,
  SuiteRunProcessingProducerAdapter,
  type QueueSimulationRunCommandData,
  type StartSuiteRunCommandData,
} from "@langwatch/suite-server";

/**
 * A write this deployment cannot enqueue, refused by name.
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

/** Writes the absence to the process log, once, at composition time. */
export class LoggedApiAgentPipelinesAbsence extends ApiAgentPipelinesAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiAgentPipelinesAbsence {
    return new LoggedApiAgentPipelinesAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  withoutQueue(): void {
    this.logger.warn(
      { capability: "agent-commands" },
      "API process holds no command queue, so it registered no simulation, suite or Langy conversation pipeline: starting a scenario run, cancelling one, starting a suite run, and every conversation write refuse by name. Reading runs, suites, conversations and messages is unaffected, and every live channel still streams.",
    );
  }
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
    registered: eventing.register(
      SimulationProcessingProducerAdapter.create({ processName }).build(),
    ),
  });
  const suite = commandLookup({
    pipeline: "suite_run_processing",
    registered: eventing.register(
      SuiteRunProcessingProducerAdapter.create({ processName }).build(),
    ),
  });
  const langy = commandLookup({
    pipeline: "langy_conversation_processing",
    registered: eventing.register(LangyConversationProducerAdapter.create({ processName }).build()),
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
 * Reads one registration's senders, FAILING AT BOOT for a command it did not produce.
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
