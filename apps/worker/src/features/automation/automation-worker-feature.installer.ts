import type { TriggerMatchRecordedEventData } from "@langwatch/automation-contract";
import { AutomationTriggerMatchRecorderPort } from "@langwatch/automation-server";
import type { AutomationIntentRetentionPort } from "@langwatch/automation-server";
import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

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
export interface AutomationWorkerCapability {
  /**
   * Builds the pipeline definition against the worker's own process store.
   * Retention is supplied by the installer rather than the composition root so
   * the intent retention and the outbox it prunes can never come from two
   * different process stores.
   */
  buildPipeline(options: {
    retention: AutomationIntentRetentionPort;
  }): Parameters<WorkerEventingRuntime["eventSourcing"]["register"]>[0];
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
  static create(options: {
    installer: AutomationWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): AutomationWorkerFeatureInstaller {
    return new AutomationWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "automation";
  /** Handed to trigger-match producers before this installer runs. */
  readonly triggerMatches = new WorkerAutomationTriggerMatches();
  private installed = false;

  private constructor(
    private readonly installer: AutomationWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      const pipeline = this.eventing.eventSourcing.register(
        this.installer.buildPipeline({ retention: this.eventing.processStore }),
      );
      const recordTriggerMatch = pipeline.commands.recordTriggerMatch;
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
      this.installed = true;
    }
    return AutomationWorkerFeatureHandle.create();
  }
}

class AutomationWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): AutomationWorkerFeatureHandle {
    return new AutomationWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
