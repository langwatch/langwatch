import type { TriggerMatchRecordedEventData } from "@langwatch/automation-contract";
import { type AutomationTriggerMatchRecorder,type AutomationIntentRetention } from "@langwatch/automation-server";
import type {
  Event,
  Projection,
  RegisteredCommand,
  StaticPipelineDefinition,
} from "@langwatch/eventing";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/**
 * A registrable Eventing definition, left open in its own event union.
 * `prepareEventForProjection` is contravariant in the event type, so pinning
 * to the base `Event` would refuse a feature's own discriminated union.
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
 * The canonical durable recorder, handed out before Automation installs. Uses
 * late-binding to connect the real command sender at install time.
 */
class WorkerAutomationTriggerMatches implements AutomationTriggerMatchRecorder {
  private delegate: AutomationTriggerMatchRecorder | undefined;

  connect(delegate: AutomationTriggerMatchRecorder): void {
    this.delegate = delegate;
  }

  async send(input: RecordTriggerMatchInput): Promise<void> {
    if (!this.delegate) {
      throw new Error("Automation must install before trigger matches are recorded.");
    }
    await this.delegate.send(input);
  }
}

class RegisteredAutomationTriggerMatches implements AutomationTriggerMatchRecorder {
  static create(command: {
    send(data: RecordTriggerMatchInput): Promise<unknown>;
  }): RegisteredAutomationTriggerMatches {
    return new RegisteredAutomationTriggerMatches(command);
  }

  private constructor(
    private readonly command: { send(data: RecordTriggerMatchInput): Promise<unknown> },
  ) {}

  async send(input: RecordTriggerMatchInput): Promise<void> {
    await this.command.send(input);
  }
}

/** Automation's worker-facing capability after its server graph is composed. */
export interface AutomationWorkerCapability<TEvent extends Event = Event> {
  /**
   * Builds the pipeline definition against the worker's own process store.
   * Retention is supplied by the installer, not the composition root, so the
   * intent retention and the outbox it prunes never come from two stores.
   */
  buildPipeline(options: {
    retention: AutomationIntentRetention;
  }): WorkerPipelineDefinition<TEvent>;
}

/**
 * Worker registration for the Automation pipeline. Installs first among feature
 * installers; its recordTriggerMatch command is the durable write path.
 */
export class AutomationWorkerFeatureInstaller implements WorkerFeatureInstaller {
  /**
   * The registration is captured as a closure to erase the event union, keeping
   * the class itself free of the event type.
   */
  static create<TEvent extends Event>(options: {
    installer: AutomationWorkerCapability<TEvent>;
    eventing: WorkerEventingRuntime;
    /**
     * The optional scheduled-report calendar. Rides Automation's installer
     * because a report is an automation.
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
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
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
    const reportSchedule = this.reportSchedule;
    return reportSchedule ? () => reportSchedule.stop() : undefined;
  }
}

/** The report calendar's lifecycle, as this installer drives it. */
export interface AutomationReportSchedule {
  start(): void;
  stop(): Promise<void>;
}
