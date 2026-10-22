/**
 * The per-credential read budget (specs/security/read-rate-limits.feature): requests per minute
 * and rows per hour and day, counted for the credential, never the project. Log-only until the
 * process says enforcement is on; a counting store that fails never refuses a read.
 */
import type { AuthzDeclaredScopeId } from "@langwatch/authorization";

import { ReadRateLimitedError } from "./errors.ts";
import type { RateLimiter } from "./ports.ts";

/** The log event the security alerting reads; its field names are a contract with it. */
export const READ_RATE_LIMIT_EXCEEDED_EVENT = "read_rate_limit_exceeded";
/** The audit line every read made by an operator acting as somebody leaves. */
export const IMPERSONATED_READ_EVENT = "impersonated_read";

export type ReadCredentialType =
  | "api_key"
  | "access_token"
  | "legacy_project_key"
  | "ingestion_key"
  | "langy_session_key"
  | "session"
  | "impersonation";

/** Who a read counts against. An impersonated read is the operator's, not the person's. */
export type ReadCredential = Readonly<{
  id: string;
  type: ReadCredentialType;
  impersonatorId?: string | undefined;
  subjectUserId?: string | undefined;
}>;

export type ReadKind = "read" | "export";

export type ReadBudgetLimits = Readonly<{
  readsPerMinute: number;
  rowsPerHour: number;
  rowsPerDay: number;
  exportsPerMinute: number;
  exportsPerDay: number;
  impersonationReadsPerMinute: number;
  impersonationRowsPerDay: number;
}>;

export type ReadBudgetDimension =
  | "reads_per_minute"
  | "exports_per_minute"
  | "exports_per_day"
  | "rows_per_hour"
  | "rows_per_day";

type Logged = (fields: Record<string, unknown>, message: string) => void;

export type ReadBudgetDeps = Readonly<{
  /** The process's fixed-window counter; `cost` 0 reads a window without spending it. */
  counter: RateLimiter;
  limitsFor(input: {
    scope: AuthzDeclaredScopeId | null;
  }): Promise<Readonly<{ limits: ReadBudgetLimits; organizationId: string | null }>>;
  enforced(input: { scope: AuthzDeclaredScopeId | null }): Promise<boolean>;
  logger: Readonly<{ info: Logged; warn: Logged; error: Logged }>;
}>;

export type ReadCall = Readonly<{
  credential: ReadCredential;
  kind: ReadKind;
  /** `<family>.<operation>` for REST, the procedure path for tRPC. */
  route: string;
  scope: AuthzDeclaredScopeId | null;
}>;

type Window = Readonly<{
  dimension: ReadBudgetDimension;
  suffix: string;
  requests: number;
  seconds: number;
}>;

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;

export class ReadBudget {
  static create(deps: ReadBudgetDeps): ReadBudget {
    return new ReadBudget(deps);
  }

  readonly #deps: ReadBudgetDeps;

  private constructor(deps: ReadBudgetDeps) {
    this.#deps = deps;
  }

  /** Counts the call and refuses it, when enforced, if any of its windows is spent. */
  async admit(call: ReadCall): Promise<void> {
    if (call.credential.type === "impersonation") this.#auditImpersonated(call);

    const refusal = await this.#guarded(call, async () => {
      const { limits, organizationId } = await this.#deps.limitsFor({ scope: call.scope });
      for (const window of admissionWindows(call, limits)) {
        const cost = window.dimension.startsWith("rows_") ? 0 : 1;
        const decision = await this.#deps.counter.check(
          keyOf(call.credential, window),
          window,
          cost,
        );
        if (decision.allowed) continue;

        const retryAfterSeconds = decision.retryAfterSeconds ?? window.seconds;
        const enforced = await this.#deps.enforced({ scope: call.scope });
        this.#logExceeded({
          call,
          window,
          organizationId,
          enforced,
          retryAfterSeconds,
          observed: decision.used,
        });

        return enforced
          ? new ReadRateLimitedError({ dimension: window.dimension, retryAfterSeconds })
          : undefined;
      }
      return undefined;
    });

    if (refusal) throw refusal;
  }

  /** Adds the rows a read answered to the credential's hour and day; never refuses. */
  async record(call: ReadCall & Readonly<{ rows: number }>): Promise<void> {
    if (call.rows <= 0) return;

    await this.#guarded(call, async () => {
      const { limits, organizationId } = await this.#deps.limitsFor({ scope: call.scope });
      for (const window of rowWindows(call.credential, limits)) {
        const decision = await this.#deps.counter.check(
          keyOf(call.credential, window),
          window,
          call.rows,
        );
        if (decision.allowed) continue;

        const enforced = await this.#deps.enforced({ scope: call.scope });
        const retryAfterSeconds = decision.retryAfterSeconds ?? window.seconds;
        this.#logExceeded({
          call,
          window,
          organizationId,
          enforced,
          retryAfterSeconds,
          observed: decision.used,
        });
      }
      return undefined;
    });
  }

  async #guarded(
    call: ReadCall,
    run: () => Promise<ReadRateLimitedError | undefined>,
  ): Promise<ReadRateLimitedError | undefined> {
    try {
      return await run();
    } catch (error) {
      this.#deps.logger.error(
        {
          event: "read_budget_unavailable",
          route: call.route,
          credentialType: call.credential.type,
          err: error,
        },
        "read budget could not be counted; the read was admitted",
      );
      return undefined;
    }
  }

  #logExceeded({
    call,
    window,
    organizationId,
    enforced,
    retryAfterSeconds,
    observed,
  }: {
    call: ReadCall;
    window: Window;
    organizationId: string | null;
    enforced: boolean;
    retryAfterSeconds: number;
    observed: number | undefined;
  }): void {
    this.#deps.logger.warn(
      {
        event: READ_RATE_LIMIT_EXCEEDED_EVENT,
        credentialId: call.credential.id,
        credentialType: call.credential.type,
        impersonatorId: call.credential.impersonatorId ?? null,
        route: call.route,
        kind: call.kind,
        dimension: window.dimension,
        limit: window.requests,
        observed: observed ?? null,
        windowSeconds: window.seconds,
        retryAfterSeconds,
        enforced,
        projectId: call.scope?.tier === "project" ? call.scope.id : null,
        organizationId,
      },
      enforced ? "read rate limit exceeded; refused" : "read rate limit exceeded; logged only",
    );
  }

  #auditImpersonated(call: ReadCall): void {
    this.#deps.logger.info(
      {
        event: IMPERSONATED_READ_EVENT,
        impersonatorId: call.credential.impersonatorId ?? call.credential.id,
        subjectUserId: call.credential.subjectUserId ?? null,
        route: call.route,
        kind: call.kind,
        projectId: call.scope?.tier === "project" ? call.scope.id : null,
      },
      "read made while acting as another user",
    );
  }
}

function admissionWindows(call: ReadCall, limits: ReadBudgetLimits): readonly Window[] {
  const impersonated = call.credential.type === "impersonation";
  const requests: readonly Window[] =
    call.kind === "export"
      ? [
          {
            dimension: "exports_per_minute",
            suffix: "exports-minute",
            requests: impersonated
              ? Math.min(limits.exportsPerMinute, limits.impersonationReadsPerMinute)
              : limits.exportsPerMinute,
            seconds: MINUTE,
          },
          {
            dimension: "exports_per_day",
            suffix: "exports-day",
            requests: limits.exportsPerDay,
            seconds: DAY,
          },
        ]
      : [
          {
            dimension: "reads_per_minute",
            suffix: "reads-minute",
            requests: impersonated ? limits.impersonationReadsPerMinute : limits.readsPerMinute,
            seconds: MINUTE,
          },
        ];

  return [...requests, ...rowWindows(call.credential, limits)];
}

function rowWindows(credential: ReadCredential, limits: ReadBudgetLimits): readonly Window[] {
  const impersonated = credential.type === "impersonation";
  return [
    {
      dimension: "rows_per_hour",
      suffix: "rows-hour",
      requests: impersonated ? limits.impersonationRowsPerDay : limits.rowsPerHour,
      seconds: HOUR,
    },
    {
      dimension: "rows_per_day",
      suffix: "rows-day",
      requests: impersonated ? limits.impersonationRowsPerDay : limits.rowsPerDay,
      seconds: DAY,
    },
  ];
}

function keyOf(credential: ReadCredential, window: Window): string {
  return `read-budget:${credential.type}:${credential.id}:${window.suffix}`;
}

/** Rows an answer carries: a list's length, the longest top-level list of an object, else one. */
export function rowsOf(answer: unknown): number {
  if (answer === undefined || answer === null) return 0;
  if (Array.isArray(answer)) return answer.length;
  if (typeof answer !== "object") return 1;

  let longest = 0;
  for (const value of Object.values(answer)) {
    if (Array.isArray(value) && value.length > longest) longest = value.length;
  }
  return Math.max(longest, 1);
}

/** Whether an operation reads, exports, or is a write the budget does not count. */
export function readKindOf({
  operation,
  method,
}: {
  operation: string;
  method: string;
}): ReadKind | null {
  if (/export|download/i.test(operation)) return "export";
  if (method.toUpperCase() === "GET") return "read";
  if (/^(search|list|get|find|query|fetch)/i.test(operation)) return "read";
  return null;
}
