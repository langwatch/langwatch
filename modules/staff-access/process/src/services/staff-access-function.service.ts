import { StaffAccessAuditUnavailableError } from "@langwatch/api";
import type { StaffAccessScope } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import {
  isStaffAccessFunctionName,
  STAFF_ACCESS_FUNCTION_NAMES,
  STAFF_ACCESS_FUNCTIONS,
  StaffAccessNotFoundError,
  StaffFunctionBadInputError,
  StaffFunctionNotApprovedError,
  StaffFunctionScopeMismatchError,
  StaffFunctionUnknownError,
  type StaffAccessDoorSession,
  type StaffAccessFunctionAnswer,
  type StaffAccessFunctionList,
  type StaffAccessFunctionName,
} from "@langwatch/staff-access-contract";
import type { Instant } from "@langwatch/time";
import { z } from "zod";

import type {
  StaffAccessEventRepository,
  StaffAccessRequestRepository,
  StaffAccessRequestRow,
} from "../repositories/staff-access.repository.ts";
import { functionFitsScopes } from "../rules/staff-access-function.rules.ts";
import type { StaffAccessFunctionReadsService } from "./staff-access-function-reads.service.ts";

type FunctionDeps = Readonly<{
  requests: Pick<StaffAccessRequestRepository, "findById">;
  events: StaffAccessEventRepository;
  reads: StaffAccessFunctionReadsService;
  now: () => Instant;
}>;

/**
 * The ops functions (ADR-202, amendment 2026-11-25): lists the registry, and runs one function
 * a live session's approval named. The input is parsed by the function's schema, the trail row
 * is written first, and the output is parsed by its declared schema, so nothing undeclared leaves.
 */
export class StaffAccessFunctionService {
  private constructor(private readonly deps: FunctionDeps) {}

  static create(deps: FunctionDeps): StaffAccessFunctionService {
    return new StaffAccessFunctionService(deps);
  }

  listFunctions(): StaffAccessFunctionList {
    const items = STAFF_ACCESS_FUNCTION_NAMES.map((name) => {
      const declared = STAFF_ACCESS_FUNCTIONS[name];
      return {
        name,
        title: declared.title,
        scope: declared.scope,
        answers: declared.answers,
        personal: "personal" in declared && declared.personal === true,
        inputSchema: z.toJSONSchema(declared.input, { io: "input" }) as Record<string, unknown>,
      };
    });
    return { items, total: items.length, truncated: false, nextCursor: null };
  }

  /**
   * @throws {StaffFunctionUnknownError} for a name the registry does not hold
   * @throws {StaffFunctionNotApprovedError} for a function the approval did not name
   * @throws {StaffFunctionBadInputError} for an input its schema refuses
   * @throws {StaffAccessAuditUnavailableError} when the trail row could not be written
   */
  async callFunction({
    session,
    name,
    input,
  }: {
    session: StaffAccessDoorSession;
    name: string;
    input: unknown;
  }): Promise<StaffAccessFunctionAnswer> {
    if (session.kind !== "ops") throw new StaffAccessNotFoundError();
    if (!isStaffAccessFunctionName(name)) {
      throw new StaffFunctionUnknownError({ names: STAFF_ACCESS_FUNCTION_NAMES });
    }
    const [row] = await this.deps.requests.findById({ id: session.requestId });
    if (!row) throw new StaffAccessNotFoundError();
    if (!row.functions.includes(name)) throw new StaffFunctionNotApprovedError();
    const scopes = row.scopes as StaffAccessScope[];
    const organizationId = STAFF_ACCESS_FUNCTIONS[name].scope === "org" ? row.organizationId : null;
    if (
      !functionFitsScopes({ name, scopes }) ||
      (STAFF_ACCESS_FUNCTIONS[name].scope === "org" && !organizationId)
    ) {
      throw new StaffFunctionScopeMismatchError({ name });
    }
    const parsed = STAFF_ACCESS_FUNCTIONS[name].input.safeParse(input ?? {});
    if (!parsed.success) {
      throw new StaffFunctionBadInputError({
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }

    const eventId = await this.trail({ session, row, name, input: parsed.data, organizationId });
    const startedAt = this.deps.now();
    const finish = (status: number, errorCode: string | null, rowCount?: number) =>
      this.deps.events
        .finish({
          id: eventId,
          status,
          errorCode,
          durationMs: this.deps.now().epochMilliseconds - startedAt.epochMilliseconds,
          ...(rowCount === undefined ? {} : { rowCount }),
        })
        .catch(() => undefined);
    try {
      const raw = await this.deps.reads.run({
        name,
        input: parsed.data,
        organizationId,
        at: startedAt,
      });
      const output = STAFF_ACCESS_FUNCTIONS[name].output.parse(raw) as unknown;
      const rows = rowCountOf(output);
      await finish(200, null, rows);
      return { name, rows, output };
    } catch (error) {
      const handled = HandledError.isHandled(error) ? error : null;
      await finish(handled?.httpStatus ?? 500, handled?.code ?? null);
      throw error;
    }
  }

  private async trail({
    session,
    row,
    name,
    input,
    organizationId,
  }: {
    session: Extract<StaffAccessDoorSession, { kind: "ops" }>;
    row: StaffAccessRequestRow;
    name: StaffAccessFunctionName;
    input: unknown;
    organizationId: string | null;
  }): Promise<string> {
    const id = generate("staffevent").toString();
    try {
      await this.deps.events.create({
        id,
        requestId: row.id,
        at: this.deps.now(),
        method: "POST",
        path: `/api/staff-access/functions/${name}`,
        operation: "staffAccess.callFunction",
        functionName: name,
        functionInput: JSON.stringify(input),
        rowCount: null,
        permissions: [],
        organizationId,
        projectId: null,
        status: null,
        errorCode: null,
        durationMs: null,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      });
    } catch {
      throw new StaffAccessAuditUnavailableError();
    }
    return id;
  }
}

/** A page answers its items; any other answer is one row. */
function rowCountOf(output: unknown): number {
  if (typeof output === "object" && output !== null && "items" in output) {
    const { items } = output as { items: unknown };
    if (Array.isArray(items)) return items.length;
  }
  return 1;
}
