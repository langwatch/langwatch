/**
 * The audit trail every completed mutation on this process is recorded on.
 *
 * `ApiAuditPort` is declared by `api-request.policy.ts`, threaded through the whole tRPC
 * chain and every packaged REST family, and was supplied by nobody: `ApiRuntimeComposition`
 * read it off its options and `api.main.ts` composes with no options at all. So the two audit
 * middlewares ran, built a row, handed it to `this.http?.audit?.(...)` and dropped it. Main
 * wrote the same row on every mutation and every non-internal tRPC failure, through
 * `auditLog` over its own Prisma client.
 *
 * The Enterprise audit-log feature holds the whole graph already — the service, its argument
 * bounding and the Prisma repository — and nothing imported it. This is the composition that
 * does, reached through `@langwatch/enterprise-api` because an API-role process may depend on
 * the Enterprise API composition and on no Enterprise feature server below it.
 */
import { auditScopeIds } from "@langwatch/api/trpc";
import { AuditLogAdapter } from "@langwatch/enterprise-api";
import type { Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { ApiAuditPort } from "../api-request.policy.ts";
import type { ApiAuditEvent } from "../api.application.ts";

/** Reports the composition decision an absent connection would otherwise hide. */
export abstract class ApiEnterpriseAuditAbsenceReport {
  /** Nothing is recorded, and which collaborator decided that. */
  abstract absent(because: string): void;
}

/** Names the absent collaborator on the process's own logger. */
export class LoggedApiEnterpriseAuditAbsence extends ApiEnterpriseAuditAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiEnterpriseAuditAbsence {
    return new LoggedApiEnterpriseAuditAbsence(logger);
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

export type ApiEnterpriseAuditOptions = Readonly<{
  /**
   * The one guarded connection every audit row is written on, resolved at RECORD time.
   *
   * A thunk rather than a value because the request policy holding this port is built before
   * the composition sequence reaches the database, and a port that captured the connection
   * then would hold `undefined` for the life of the process.
   */
  prisma: () => PrismaClient | undefined;
  /** How much of a call's arguments one row keeps. The service's own bound when absent. */
  maxArgsBytes?: number | undefined;
  report?: ApiEnterpriseAuditAbsenceReport | undefined;
}>;

/**
 * The trail, as the tRPC chain and the packaged REST families write to it.
 *
 * The scope ids are DERIVED from the recorded arguments rather than asked of the caller.
 * `ApiAuditEvent` carries the actor, the action and the arguments and nothing else, while the
 * organization and project a row is filed under are named inside those arguments — the same
 * derivation `@langwatch/api/trpc` already makes for the middleware's own row. Deriving it
 * here is what keeps the `organizationId` and `projectId` columns populated, which is what
 * every per-tenant audit read filters on.
 *
 * The arguments arrive REDACTED: the runtime policy runs `redactAuditArgs` before it reaches
 * the port, so nothing here has to know which fields carry a credential.
 */
export class ApiEnterpriseAudit extends ApiAuditPort {
  static create(options: ApiEnterpriseAuditOptions): ApiEnterpriseAudit {
    return new ApiEnterpriseAudit(options);
  }

  private constructor(private readonly options: ApiEnterpriseAuditOptions) {
    super();
  }

  async record(event: ApiAuditEvent): Promise<void> {
    const prisma = this.options.prisma();
    if (!prisma) {
      this.options.report?.absent("database connection");
      return;
    }

    const scopes = auditScopeIds(event.input);
    const failure = asError(event.error);
    await AuditLogAdapter.create({
      prisma,
      ...(this.options.maxArgsBytes === undefined
        ? {}
        : { maxArgsBytes: this.options.maxArgsBytes }),
    }).record({
      userId: event.actorId,
      action: event.path,
      args: event.input,
      ...(scopes.organizationId === undefined ? {} : { organizationId: scopes.organizationId }),
      ...(scopes.projectId === undefined ? {} : { projectId: scopes.projectId }),
      ...(failure ? { error: failure } : {}),
    });
  }
}

/**
 * Composes the trail this process records on.
 *
 * Always a port, never `undefined`: the connection it writes on is opened after the request
 * policy that holds it, so an absent database is reported at the call that found it rather
 * than decided once at composition.
 */
export function composeApiEnterpriseAudit(options: ApiEnterpriseAuditOptions): ApiAuditPort {
  return ApiEnterpriseAudit.create(options);
}

/**
 * A recorded failure as the trail stores it. Anything that is not already an Error is
 * described rather than dropped: a row saying a call failed without saying how is not read.
 */
function asError(failure: unknown): Error | undefined {
  if (failure === null || failure === undefined) return undefined;
  if (failure instanceof Error) return failure;
  return new Error(String(failure));
}
