/**
 * What an ingestion source's fields must satisfy before a write: a schedule that is a real cron
 * expression, an adapter and a report that stay fixed once the source has pulled, and a trace
 * destination the organization actually owns. Each refusal is copy the operator can act on.
 */

import {
  GovernanceValidationError,
  pullScheduleSchema,
  type GovernanceIngestionSource,
} from "@langwatch/enterprise-governance-contract";
import type { ProjectApi } from "@langwatch/project-contract";

export class IngestionSourceValidationService {
  private constructor(private readonly projects: ProjectApi) {}

  static create({ projects }: { projects: ProjectApi }): IngestionSourceValidationService {
    return new IngestionSourceValidationService(projects);
  }

  assertPullSchedule(value: string | null | undefined): void {
    if (value == null) {
      return;
    }

    const parsed = pullScheduleSchema.safeParse(value);
    if (parsed.success) {
      return;
    }

    const complaints = parsed.error.issues.map((issue) => issue.message);

    throw new GovernanceValidationError(
      complaints.join(" ") || "Pull schedule is not a valid cron expression",
      { formErrors: complaints },
    );
  }

  assertAdapterUnchanged(stored: Record<string, unknown>, incoming: Record<string, unknown>): void {
    const adapter = stored.adapter;
    if (typeof adapter !== "string") {
      return;
    }

    if (incoming.adapter === adapter) {
      return;
    }

    const message =
      `This source runs on the ${adapter} adapter, which is fixed when the source is created. ` +
      "Archive this source and create a new one to change how it pulls.";

    throw new GovernanceValidationError(message, { formErrors: [message] });
  }

  /**
   * Whether `pollerCursor` holds a real cursor. `pollerCursor` is `Json?`, and the write path
   * stores either `Prisma.JsonNull` or a string — see
   * ingestion-pull-run-projection.prisma.repository.ts.
   */
  static hasPollerCursor(value: unknown): boolean {
    if (value == null) {
      return false;
    }

    if (typeof value === "string") {
      return hasContentAsCursorString(value);
    }

    if (typeof value === "object") {
      return Object.keys(value).length > 0;
    }

    return false;
  }

  assertReportUnchangedOncePulled(
    existing: GovernanceIngestionSource,
    incoming: Record<string, unknown>,
  ): boolean {
    const report = existing.parserConfig.report;
    if (typeof report !== "string" || incoming.report === report) {
      return false;
    }

    if (!IngestionSourceValidationService.hasPollerCursor(existing.pollerCursor)) {
      return true;
    }

    const message =
      incoming.report === undefined
        ? `This source is configured for its ${report} report, and has already pulled it. ` +
          "An update that replaces the configuration has to carry the same report value rather than omit it."
        : `This source has already pulled its ${report} report. ` +
          "Changing the report would record the same spend a second time, so it is fixed once a source has run.";

    throw new GovernanceValidationError(message, { formErrors: [message] });
  }

  async assertTraceDestination(input: {
    organizationId: string;
    traceProjectId: string | null | undefined;
  }): Promise<void> {
    if (!input.traceProjectId) {
      return;
    }

    const project = await this.projects.tryGetWithTeam(input.traceProjectId);
    const isAllowed =
      project !== null &&
      project.archivedAt === null &&
      project.team.organizationId === input.organizationId;
    if (isAllowed) {
      return;
    }

    const message = "Trace destination must be an active project of this organization.";

    throw new GovernanceValidationError(message, { formErrors: [message] });
  }
}

/**
 * A cursor string carries content unless it is empty, or it is the
 * serialization of something that carries none. An opaque page token is not
 * JSON and keeps its "yes" by falling through the parse.
 */
function hasContentAsCursorString(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed == null) {
      return false;
    }

    if (typeof parsed === "object") {
      return Object.keys(parsed).length > 0;
    }

    return true;
  } catch {
    return true;
  }
}
