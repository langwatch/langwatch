import { ApiAutomationUnavailableError } from "@langwatch/automation-contract";

import type { AutomationRunawayNotice } from "../channels/automation-runaway-notice.channel.ts";
import type { AutomationRunawayRepository } from "../repositories/automation-runaway.repository.ts";
import type { AutomationLogger } from "./automation.service.ts";
import type { AutomationRunawaySignals } from "./runaway-containment.service.ts";

/**
 * Runaway containment, for a process that fires nothing: reads answer
 * emptily and writes refuse, since a ceiling enforced here would be one
 * nobody actually counts against.
 */
export class AutomationRunawayUncontainedService
  implements AutomationRunawayRepository, AutomationRunawayNotice, AutomationRunawaySignals
{
  static create(logger: AutomationLogger): AutomationRunawayUncontainedService {
    return new AutomationRunawayUncontainedService(logger);
  }

  private constructor(private readonly logger: AutomationLogger) {}

  countProjectTraces24h(): Promise<number> {
    return Promise.resolve(0);
  }

  notificationRecipients(): Promise<string[]> {
    return Promise.resolve([]);
  }

  sendLimitEmail(): Promise<void> {
    return Promise.reject(new ApiAutomationUnavailableError("send automation limit mail"));
  }

  findNextStep(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  claimOnce(): Promise<"already-claimed"> {
    return Promise.resolve("already-claimed");
  }

  releaseClaim(): Promise<void> {
    return Promise.resolve();
  }

  projectName(projectId: string): Promise<string> {
    return Promise.resolve(projectId);
  }

  automationUrl(): Promise<string> {
    return Promise.resolve("");
  }

  onCeilingBreach(): void {
    this.logger.warn({}, "an automation reached its daily persist ceiling");
  }

  onAutoPaused(reason: string): void {
    this.logger.warn({ reason }, "an automation was paused by containment");
  }

  onContainmentFailed(): void {
    this.logger.warn({}, "automation containment could not complete");
  }

  error(fields: Record<string, unknown>, message: string): void {
    this.logger.error(fields, message);
  }

  info(fields: Record<string, unknown>, message: string): void {
    this.logger.info(fields, message);
  }
}
