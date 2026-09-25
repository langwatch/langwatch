import type { AuthzService } from "@langwatch/authz-contract";
import type { AutomationLimitNextStep } from "@langwatch/automation-contract";
import { type EmailDelivery, sendAutomationLimitEmail } from "@langwatch/mail";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import type { TraceApi } from "@langwatch/trace-contract";

import type { AutomationRunawayMetricsSink } from "../app/automation.members.ts";
import type { AutomationContainmentClaimRepository } from "../repositories/automation-containment-claim.repository.ts";
import {
  AutomationRunawayRepository,
  type ClaimLease,
} from "../repositories/automation-runaway.repository.ts";

/**
 * Who a limit notice goes to, resolved through this process's own
 * directories. Two collaborators: a project breaches the ceiling, but its
 * admins are named on the ORGANIZATION, so the project directory bridges them.
 */
export type AutomationRunawayDirectories = Readonly<{
  projects: Pick<ProjectApi, "getOrganizationId" | "findById">;
  authorization: Pick<AuthzService, "listOrganizationBindings">;
}>;

/** Which addresses this project has already asked not to hear from again. */
export type AutomationRunawaySuppression = Readonly<{
  filterSuppressed(input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]>;
}>;

/**
 * Where a project's organization can go for a higher ceiling. Optional: a
 * deployment that composed no self-serve catalogue still contains a runaway
 * automation, it just names no upgrade in the mail.
 */
export type AutomationNextStepResolver = Readonly<{
  resolve(projectId: string): Promise<AutomationNextStepResolution>;
}>;

/** Whether the mail can name an upgrade; `unnamed` is the normal answer for many plans. */
export type AutomationNextStepResolution =
  | { kind: "named"; nextStep: AutomationLimitNextStep }
  | { kind: "unnamed" };

/**
 * Infrastructure for Automation's runaway containment, in this process. Owns the
 * substrates that policy names (trace counts, admin roll, mailer, etc.).
 */
export class AutomationRunawayService extends AutomationRunawayRepository {
  static create(input: {
    claims: AutomationContainmentClaimRepository;
    directories: AutomationRunawayDirectories;
    suppression: AutomationRunawaySuppression;
    mailer: EmailDelivery;
    traces: Pick<TraceApi, "countTracesInLastDay">;
    metrics: AutomationRunawayMetricsSink;
    baseHost: string;
    /** Absent on a deployment that composed no self-serve plan catalogue. */
    nextStep?: AutomationNextStepResolver | null;
    logger?: Logger;
  }): AutomationRunawayService {
    return new AutomationRunawayService(
      input,
      input.logger ?? createLogger("langwatch:automation:runaway-containment"),
    );
  }

  private constructor(
    private readonly input: {
      claims: AutomationContainmentClaimRepository;
      directories: AutomationRunawayDirectories;
      suppression: AutomationRunawaySuppression;
      mailer: EmailDelivery;
      traces: Pick<TraceApi, "countTracesInLastDay">;
      metrics: AutomationRunawayMetricsSink;
      baseHost: string;
      nextStep?: AutomationNextStepResolver | null;
    },
    private readonly logger: Logger,
  ) {
    super();
  }

  countProjectTraces24h(projectId: string): Promise<number> {
    return this.input.traces.countTracesInLastDay({ projectId });
  }

  async notificationRecipients(input: { projectId: string; triggerId: string }): Promise<string[]> {
    const { projectId, triggerId } = input;
    const organizationId = await this.input.directories.projects.getOrganizationId(projectId);
    const bindings = await this.input.directories.authorization.listOrganizationBindings({
      organizationId,
    });
    const emails = [
      ...new Set(
        bindings.flatMap((binding) =>
          binding.role === "ADMIN" && binding.user?.email ? [binding.user.email] : [],
        ),
      ),
    ];
    if (emails.length === 0) return emails;

    try {
      return await this.input.suppression.filterSuppressed({ projectId, triggerId, emails });
    } catch (error) {
      // Fall OPEN. A suppression list this process cannot read is a reason to
      // mail an administrator one message they might have muted, not a reason
      // to leave a runaway automation uncontained and nobody told.
      this.logger.warn(
        { projectId, triggerId, error: error instanceof Error ? error.message : String(error) },
        "Could not read the automation suppression list; notifying every administrator",
      );

      return emails;
    }
  }

  sendLimitEmail(params: {
    to: string[];
    kind: "ceiling_reached" | "paused";
    automationName: string;
    projectName: string;
    dailyCeiling: number;
    skippedToday: number;
    actionUrl: string;
    nextStep?: AutomationLimitNextStep;
  }): Promise<void> {
    return sendAutomationLimitEmail({ mailer: this.input.mailer, ...params });
  }

  async findNextStep(projectId: string): Promise<AutomationLimitNextStep | undefined> {
    const resolution = await this.input.nextStep?.resolve(projectId);
    return resolution?.kind === "named" ? resolution.nextStep : undefined;
  }

  claimOnce(key: string, ttlSeconds?: number): Promise<ClaimLease | "already-claimed"> {
    return this.input.claims.claimOnce(key, ttlSeconds);
  }

  releaseClaim(lease: ClaimLease): Promise<void> {
    return this.input.claims.releaseClaim(lease);
  }

  async projectName(projectId: string): Promise<string> {
    return (await this.input.directories.projects.findById(projectId))?.name ?? "your project";
  }

  async automationUrl(input: { projectId: string; triggerId: string }): Promise<string> {
    const project = await this.input.directories.projects.findById(input.projectId);

    return `${this.input.baseHost}/${project?.slug ?? ""}/automations?drawer.open=automation&drawer.automationId=${input.triggerId}`;
  }

  onCeilingBreach(): void {
    this.input.metrics.onCeilingBreach();
  }

  onAutoPaused(reason: string): void {
    this.input.metrics.onAutoPaused(reason);
  }

  onContainmentFailed(): void {
    this.input.metrics.onContainmentFailed();
  }

  error(fields: Record<string, unknown>, message: string): void {
    this.logger.error(fields, message);
  }

  info(fields: Record<string, unknown>, message: string): void {
    this.logger.info(fields, message);
  }
}
