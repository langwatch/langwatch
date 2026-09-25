import type { AuthApi } from "@langwatch/auth-contract";
import { SsoConnectionStringEditRetiredError } from "@langwatch/identity-contract";
import {
  adminOperationInputSchema,
  type AdminDataResult,
  type AdminOperationInput,
  type AdminOperationResult,
  type AdminOperationParams,
} from "@langwatch/ops-contract";
import { Temporal, toEpochMs } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";

import type { AdminBackofficeRepository } from "../repositories/admin-backoffice.repository.ts";
import { legacySsoStringWritesToRefuse } from "../rules/legacy-sso-string-writes.rules.ts";
import type { AdminAuditSink } from "./impersonation.service.ts";

const MUTATING_METHODS = new Set(["create", "update", "updateMany", "delete", "deleteMany"]);

export interface AdminBackofficeServiceOptions {
  repository: AdminBackofficeRepository;
  users: UserApi;
  auth: AuthApi;
  audit: AdminAuditSink;
  /** Whether an organization's own connection decides its sign-in, asked of
   *  the module that owns connections. */
  ssoRouting?: OrganizationSsoRouting | undefined;
}

/**
 * Which of the two routes decides one organization's sign-in. Routing reads
 * the connection projection first and falls back to the legacy columns, so the
 * answer differs by organization and is never set fleet-wide.
 */
export interface OrganizationSsoRouting {
  connectionDecides(args: { organizationId: string }): Promise<boolean>;
}

/** The answer for a process that composed no connection reader: the strings
 *  still decide, which is what an installation with no connections has. */
const STRINGS_STILL_DECIDE: OrganizationSsoRouting = {
  connectionDecides: async () => false,
};

/** Ops-owned application service for the legacy react-admin wire surface. */
export class AdminBackofficeService {
  private readonly repository: AdminBackofficeRepository;
  private readonly users: UserApi;
  private readonly auth: AuthApi;
  private readonly audit: AdminAuditSink;
  private readonly ssoRouting: OrganizationSsoRouting;

  private constructor(deps: {
    repository: AdminBackofficeRepository;
    users: UserApi;
    auth: AuthApi;
    audit: AdminAuditSink;
    ssoRouting: OrganizationSsoRouting;
  }) {
    this.repository = deps.repository;
    this.users = deps.users;
    this.auth = deps.auth;
    this.audit = deps.audit;
    this.ssoRouting = deps.ssoRouting;
  }

  static create(options: AdminBackofficeServiceOptions): AdminBackofficeService {
    return new AdminBackofficeService({
      repository: options.repository,
      users: options.users,
      auth: options.auth,
      audit: options.audit,
      ssoRouting: options.ssoRouting ?? STRINGS_STILL_DECIDE,
    });
  }

  async execute(input: AdminOperationInput): Promise<AdminOperationResult> {
    const parsed = adminOperationInputSchema.parse(input);
    if (
      parsed.resource === "user" &&
      parsed.method === "update" &&
      parsed.params.id &&
      parsed.params.data
    ) {
      return this.updateUser(parsed);
    }

    const normalized = await this.normalizeOrganizationDomain(parsed);
    const result = await this.repository.execute(normalized);
    await this.auditMutation(normalized, result);

    return result;
  }

  private async updateUser(input: AdminOperationInput): Promise<AdminOperationResult> {
    const data = { ...input.params.data };
    let handledSideEffect = false;
    const sideEffectAudits: {
      action: string;
      payload: Record<string, unknown>;
    }[] = [];

    if ("deactivatedAt" in data) {
      const value = data.deactivatedAt;
      if (value === null || value === "") {
        await this.users.reactivate({ id: String(input.params.id ?? "") });
        delete data.deactivatedAt;
        handledSideEffect = true;
        sideEffectAudits.push({
          action: "update/user",
          payload: { id: String(input.params.id ?? ""), reactivate: true },
        });
      } else if (typeof value === "string" || value instanceof Date) {
        const userId = String(input.params.id ?? "");
        await this.users.deactivate({ id: userId });
        delete data.deactivatedAt;
        handledSideEffect = true;
        const pickedMs = toEpochMs(value);
        const isValidPickedDate = !Number.isNaN(pickedMs);
        if (isValidPickedDate) {
          await this.repository.setUserDeactivatedAt(
            userId,
            Temporal.Instant.fromEpochMilliseconds(pickedMs),
          );
        }

        sideEffectAudits.push({
          action: "update/user",
          payload: {
            id: userId,
            deactivate: true,
            ...(isValidPickedDate
              ? {
                  pickedDate: Temporal.Instant.fromEpochMilliseconds(pickedMs).toString({
                    fractionalSecondDigits: 3,
                  }),
                }
              : {}),
          },
        });
      }
    }

    if ("email" in data && typeof data.email === "string") {
      const userId = String(input.params.id ?? "");
      const email = data.email.trim().toLowerCase();
      const previous = await this.users.findById({ id: userId });
      const updated = await this.users.updateProfile({ id: userId, email });
      if (previous && (previous.email ?? "").toLowerCase() !== updated.email) {
        await this.auth.revokeAllBrowserSessions({ userId });
      }

      delete data.email;
      handledSideEffect = true;
      sideEffectAudits.push({
        action: "update/user",
        payload: { id: userId, email },
      });
    }

    for (const entry of sideEffectAudits) {
      await this.audit.record({
        userId: input.actorId,
        action: `admin/${entry.action}`,
        args: entry.payload,
        req: input.req,
      });
    }

    if (handledSideEffect && Object.keys(data).length === 0) {
      return this.repository.findUserById(String(input.params.id ?? ""));
    }

    const normalized: AdminOperationInput = {
      ...input,
      params: { ...input.params, data },
    };
    const result = await this.repository.execute(normalized);
    await this.auditMutation(normalized, result);

    return result;
  }

  private async normalizeOrganizationDomain(
    input: AdminOperationInput,
  ): Promise<AdminOperationInput> {
    if (
      input.resource !== "organization" ||
      (input.method !== "create" && input.method !== "update")
    ) {
      return input;
    }

    const data = { ...input.params.data };
    const retiredColumns = legacySsoStringWritesToRefuse({
      data,
      connectionDecides: await this.connectionDecides(input),
    });
    if (retiredColumns.length > 0) {
      throw new SsoConnectionStringEditRetiredError(
        `legacy sso columns are derived: ${retiredColumns.join(", ")}`,
      );
    }

    if (typeof data.ssoDomain === "string" && data.ssoDomain.trim() !== "") {
      data.ssoDomain = data.ssoDomain.trim().toLowerCase();
    }

    return { ...input, params: { ...input.params, data } };
  }

  /** An organization being created has no connection yet, so its strings are
   *  still what decides. */
  private async connectionDecides(input: AdminOperationInput): Promise<boolean> {
    const organizationId = input.params.id;
    if (typeof organizationId !== "string" || organizationId === "") return false;
    return this.ssoRouting.connectionDecides({ organizationId });
  }

  private async auditMutation(
    input: AdminOperationInput,
    result: AdminOperationResult,
  ): Promise<void> {
    if (!MUTATING_METHODS.has(input.method)) {
      return;
    }

    const params = input.params;
    const ids = this.stringArray(params.ids);
    if (input.method === "updateMany" || input.method === "deleteMany") {
      for (const id of ids) {
        await this.recordMutationAudit(input, id);
      }

      return;
    }

    const id = this.operationId(params, result);
    if (id !== null) {
      await this.recordMutationAudit(input, id);
    }
  }

  private async recordMutationAudit(input: AdminOperationInput, id: string): Promise<void> {
    const payload: Record<string, unknown> = { id };
    if (input.params.previousData) {
      payload.previousData = input.params.previousData;
    }

    if (input.params.data) {
      payload.data = input.params.data;
    }

    await this.audit.record({
      userId: input.actorId,
      action: `admin/${this.auditAction(input.method)}/${input.resource}`,
      args: payload,
      req: input.req,
    });
  }

  private operationId(params: AdminOperationParams, result: AdminOperationResult): string | null {
    if (params.id !== undefined) {
      return String(params.id);
    }

    if (!this.isDataResult(result) || !this.isRecord(result.data)) {
      return null;
    }

    const id = result.data.id;

    return typeof id === "string" || typeof id === "number" ? String(id) : null;
  }

  private isDataResult(result: AdminOperationResult): result is AdminDataResult {
    return !Array.isArray(result.data);
  }

  private auditAction(method: AdminOperationInput["method"]): string {
    if (method === "updateMany") {
      return "update";
    }

    if (method === "deleteMany") {
      return "delete";
    }

    return method;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
  }
}
