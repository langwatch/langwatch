import {
  isMatchEverythingTrigger,
  RUNAWAY_PAUSE_REASON,
  type AutomationPersistCapBreach,
} from "@langwatch/automation-contract";
import { AutomationRunawayPort } from "../ports/automation-runaway.port";
import { AutomationClockPort } from "../ports/automation-clock.port";
import { TriggerRepository } from "../repositories/trigger.repository";

export { RUNAWAY_PAUSE_REASON };

export const PAUSE_ATTEMPT_CLAIM_SECONDS = 60;
export const CONTAINMENT_CHECK_CLAIM_SECONDS = 60;
export const RUNAWAY_TRAFFIC_SHARE = 0.9;
export const RUNAWAY_MIN_PROJECT_TRACES = 100;

/** Private, process-lifetime collaborator for claim-gated containment. */
export class RunawayContainmentService {
  private constructor(
    private readonly runaway: AutomationRunawayPort,
    private readonly triggers: TriggerRepository,
    private readonly clock: AutomationClockPort,
  ) {}

  static create(input: {
    runaway: AutomationRunawayPort;
    triggers: TriggerRepository;
    clock: AutomationClockPort;
  }): RunawayContainmentService {
    return new RunawayContainmentService(input.runaway, input.triggers, input.clock);
  }

  async handle(input: AutomationPersistCapBreach): Promise<void> {
    const { trigger, projectId, cap, skipped } = input;
    const now = this.clock.now();
    const dayBucket = Math.floor(now.getTime() / 86_400_000);
    try {
      this.runaway.onCeilingBreach();
      this.runaway.error(
        { projectId, triggerId: trigger.id, cap, count: input.count, skipped },
        "Automation passed its daily ceiling on confirmed matches; further matches are being skipped for the rest of the UTC day",
      );
      if (
        !(await this.runaway.tryClaimOnce(
          `automation-containment-check:${trigger.id}`,
          CONTAINMENT_CHECK_CLAIM_SECONDS,
        ))
      ) {
        return;
      }

      if (await this.isMisconfigured(input)) {
        await this.pauseAndNotify(input, now, dayBucket);

        return;
      }

      await this.notifyOncePerDay(
        input,
        "ceiling_reached",
        `automation-cap-mail:${trigger.id}:${dayBucket}`,
      );
    } catch (error) {
      this.runaway.onContainmentFailed();
      this.runaway.error(
        {
          projectId,
          triggerId: trigger.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "Runaway containment failed; the automation was not contained",
      );
    }
  }

  private async isMisconfigured(input: AutomationPersistCapBreach): Promise<boolean> {
    if (isMatchEverythingTrigger(input.trigger)) {
      return true;
    }

    const projectTraces = await this.runaway.countProjectTraces24h(input.projectId);

    return (
      projectTraces >= RUNAWAY_MIN_PROJECT_TRACES &&
      input.count >= projectTraces * RUNAWAY_TRAFFIC_SHARE
    );
  }

  private async pauseAndNotify(
    input: AutomationPersistCapBreach,
    now: Date,
    dayBucket: number,
  ): Promise<void> {
    if (
      !(await this.runaway.tryClaimOnce(
        `automation-pause:${input.trigger.id}`,
        PAUSE_ATTEMPT_CLAIM_SECONDS,
      ))
    ) {
      return;
    }

    await this.triggers.update({
      id: input.trigger.id,
      projectId: input.projectId,
      active: false,
      pausedReason: RUNAWAY_PAUSE_REASON,
      pausedAt: now,
    });
    this.runaway.onAutoPaused(RUNAWAY_PAUSE_REASON);
    this.runaway.error(
      {
        projectId: input.projectId,
        triggerId: input.trigger.id,
        cap: input.cap,
        count: input.count,
      },
      "Automation paused for runaway volume: its confirmed matches cover essentially all of the project's traffic",
    );
    await this.notifyOncePerDay(
      input,
      "paused",
      `automation-pause-mail:${input.trigger.id}:${dayBucket}`,
    );
  }

  private async notifyOncePerDay(
    input: AutomationPersistCapBreach,
    kind: "ceiling_reached" | "paused",
    claimKey: string,
  ): Promise<void> {
    const lease = await this.runaway.tryClaimOnce(claimKey);
    if (!lease) {
      return;
    }

    try {
      await this.notify(input, kind);
    } catch (error) {
      await this.runaway.releaseClaim(lease);

      throw error;
    }
  }

  private async notify(
    input: AutomationPersistCapBreach,
    kind: "ceiling_reached" | "paused",
  ): Promise<void> {
    const to = await this.runaway.notificationRecipients({
      projectId: input.projectId,
      triggerId: input.trigger.id,
    });
    if (to.length === 0) {
      this.runaway.info(
        { projectId: input.projectId, triggerId: input.trigger.id, kind },
        "No recipients to notify about an automation limit",
      );

      return;
    }

    await this.runaway.sendLimitEmail({
      to,
      kind,
      automationName: input.trigger.name,
      projectName: await this.runaway.projectName(input.projectId),
      dailyCeiling: input.cap,
      skippedToday: input.skipped,
      actionUrl: await this.runaway.automationUrl({
        projectId: input.projectId,
        triggerId: input.trigger.id,
      }),
    });
  }
}
