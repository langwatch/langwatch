import type { TriggerMatchRecordedEventData } from "@langwatch/automation-contract";
import { AutomationTriggerMatchRecorderPort } from "@langwatch/automation-server";
import type { AutomationIntentRetentionPort } from "@langwatch/automation-server";
import type {
  Event,
  Projection,
  RegisteredCommand,
  StaticPipelineDefinition,
} from "@langwatch/eventing";
import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/**
 * A registrable Eventing definition, left open in its own event union.
 *
 * `prepareEventForProjection` is contravariant in the event type, so a field
 * pinned to the base `Event` refuses the very definition a feature publishes
 * over its own discriminated union.
 */
type WorkerPipelineDefinition<TEvent extends Event> = StaticPipelineDefinition<
  TEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

type RecordTriggerMatchInput = TriggerMatchRecordedEventData & {
  tenantId: string;
  occurredAt: number;
};

/**
 * The canonical durable recorder, handed out before Automation installs.
 *
 * Trace processing, Evaluation and Governance trace alerts all dispatch
 * trigger matches, and all three are composed from definitions built before
 * any pipeline is registered. Rather than reorder them around Automation, they
 * receive this port and Automation connects the real command sender to it at
 * install time — the same late-binding shape Trace uses for Topic assignment.
 */
class WorkerAutomationTriggerMatches extends AutomationTriggerMatchRecorderPort {
  private delegate: AutomationTriggerMatchRecorderPort | undefined;

  connect(delegate: AutomationTriggerMatchRecorderPort): void {
    this.delegate = delegate;
  }

  async send(input: RecordTriggerMatchInput): Promise<void> {
    if (!this.delegate) {
      throw new Error("Automation must install before trigger matches are recorded.");
    }
    await this.delegate.send(input);
  }
}

class RegisteredAutomationTriggerMatches extends AutomationTriggerMatchRecorderPort {
  static create(command: {
    send(data: RecordTriggerMatchInput): Promise<unknown>;
  }): RegisteredAutomationTriggerMatches {
    return new RegisteredAutomationTriggerMatches(command);
  }

  private constructor(
    private readonly command: { send(data: RecordTriggerMatchInput): Promise<unknown> },
  ) {
    super();
  }

  async send(input: RecordTriggerMatchInput): Promise<void> {
    await this.command.send(input);
  }
}

/** Automation's worker-facing capability after its server graph is composed. */
export interface AutomationWorkerCapability<TEvent extends Event = Event> {
  /**
   * Builds the pipeline definition against the worker's own process store.
   * Retention is supplied by the installer rather than the composition root so
   * the intent retention and the outbox it prunes can never come from two
   * different process stores.
   */
  buildPipeline(options: {
    retention: AutomationIntentRetentionPort;
  }): WorkerPipelineDefinition<TEvent>;
}

/**
 * Worker registration for the Automation pipeline.
 *
 * It installs FIRST among the worker's feature installers, exactly as the
 * legacy registry registered it first: its `recordTriggerMatch` command is the
 * durable write path for every trigger match the trace, evaluation and
 * governance graphs produce, and its settlement process manager is what turns
 * those matches into one notification per window.
 */
export class AutomationWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  /**
   * The registration is captured as a closure, and that is what erases the
   * event union.
   *
   * A definition is generic in the union its feature owns, and
   * `prepareEventForProjection` is contravariant in it — so a field typed
   * against the base `Event` would refuse the very definition Automation
   * publishes, and a class generic in the union would make two instantiations
   * of this installer mutually unassignable wherever the composition root names
   * it. Registering inside `create`, where the union is still known, leaves the
   * class itself free of it.
   */
  static create<TEvent extends Event>(options: {
    installer: AutomationWorkerCapability<TEvent>;
    eventing: WorkerEventingRuntime;
    /**
     * The scheduled-report calendar, when this process composed one.
     *
     * It rides Automation's installer rather than one of its own because a
     * report IS an automation: the rows it fires are `Trigger` rows, the
     * message it sends goes through Automation's delivery, and the fire it
     * records lands in the same history the automations page reads. A second
     * installer would also have to claim a routing key on the shared queue —
     * the calendar claims none, because it is a Postgres loop rather than a
     * queue consumer.
     */
    reportSchedule?: AutomationReportSchedule;
  }): AutomationWorkerFeatureInstaller {
    return new AutomationWorkerFeatureInstaller(
      () =>
        options.eventing.eventSourcing.register(
          options.installer.buildPipeline({ retention: options.eventing.processStore }),
        ).commands,
      options.reportSchedule,
    );
  }

  readonly name = "automation";
  /** Handed to trigger-match producers before this installer runs. */
  readonly triggerMatches = new WorkerAutomationTriggerMatches();
  private installed = false;

  private constructor(
    private readonly registerPipeline: () => unknown,
    private readonly reportSchedule: AutomationReportSchedule | undefined,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      const commands = this.registerPipeline() as Record<string, unknown>;
      const recordTriggerMatch = commands.recordTriggerMatch;
      if (!recordTriggerMatch) {
        throw new Error("Automation pipeline must register a recordTriggerMatch command.");
      }
      this.triggerMatches.connect(
        RegisteredAutomationTriggerMatches.create(
          recordTriggerMatch as unknown as {
            send(data: RecordTriggerMatchInput): Promise<unknown>;
          },
        ),
      );
      this.reportSchedule?.start();
      this.installed = true;
    }
    return AutomationWorkerFeatureHandle.create(this.reportSchedule);
  }
}

/** The report calendar's lifecycle, as this installer drives it. */
export interface AutomationReportSchedule {
  start(): void;
  stop(): Promise<void>;
}

class AutomationWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(
    reportSchedule: AutomationReportSchedule | undefined,
  ): AutomationWorkerFeatureHandle {
    return new AutomationWorkerFeatureHandle(reportSchedule);
  }

  private constructor(private readonly reportSchedule: AutomationReportSchedule | undefined) {
    super();
  }

  async close(): Promise<void> {
    await this.reportSchedule?.stop();
  }
}
