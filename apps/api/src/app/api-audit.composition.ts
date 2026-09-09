import { auditScopeIds } from "@langwatch/api/trpc";
import { recordAuditLogCommandSchema, type AuditLogApi } from "@langwatch/audit-log-contract";
import type { Logger } from "@langwatch/observability";

import { ApiAuditPort } from "../api-request.policy.ts";
import type { ApiAuditEvent } from "../api.application.ts";

export abstract class ApiAuditAbsenceReport {
  abstract absent(because: string): void;
}

export class LoggedApiAuditAbsence extends ApiAuditAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiAuditAbsence {
    return new LoggedApiAuditAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(because: string): void {
    this.logger.warn(
      { trail: "audit-log" },
      `A mutation went unrecorded: this process composed no ${because}`,
    );
  }
}

/** The request policy is allocated before boot binds the fixed audit API. */
export type ApiAuditOptions = Readonly<{
  auditLog: () => AuditLogApi | undefined;
  report?: ApiAuditAbsenceReport;
}>;

export class ApiAudit extends ApiAuditPort {
  static create(options: ApiAuditOptions): ApiAudit {
    return new ApiAudit(options);
  }

  private constructor(private readonly options: ApiAuditOptions) {
    super();
  }

  async record(event: ApiAuditEvent): Promise<void> {
    const auditLog = this.options.auditLog();
    if (!auditLog) {
      this.options.report?.absent("audit-log feature");
      return;
    }

    const scopes = auditScopeIds(event.input);
    const failure = asError(event.error);
    await auditLog.record(
      recordAuditLogCommandSchema.parse({
        userId: event.actorId,
        action: event.path,
        args: event.input === void 0 ? void 0 : JSON.parse(JSON.stringify(event.input)),
        ...(scopes.organizationId === undefined ? {} : { organizationId: scopes.organizationId }),
        ...(scopes.projectId === undefined ? {} : { projectId: scopes.projectId }),
        ...(failure ? { error: failure.toString() } : {}),
      }),
    );
  }
}

export function composeApiAudit(options: ApiAuditOptions): ApiAuditPort {
  return ApiAudit.create(options);
}

function asError(failure: unknown): Error | undefined {
  if (failure === null || failure === undefined) return undefined;
  if (failure instanceof Error) return failure;
  return new Error(String(failure));
}
