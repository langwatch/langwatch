import type { LedgerActor } from "@langwatch/authorization";
import { ValidationError } from "@langwatch/handled-error";
import { SsoConnectionStringEditRetiredError } from "@langwatch/identity-contract";
import {
  adminOperationInputSchema,
  type AdminDataResult,
  type AdminOperationInput,
  type AdminOperationResult,
  type AdminOperationParams,
} from "@langwatch/ops-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { AdminBackofficeRepository } from "../repositories/admin-backoffice.repository.ts";
import { legacySsoStringWritesToRefuse } from "../rules/legacy-sso-string-writes.rules.ts";
import type { AdminAuditSink } from "./impersonation.service.ts";

const MUTATING_METHODS = new Set(["create", "update", "updateMany", "delete", "deleteMany"]);
/** User writes that would skip the user module's facts and last-operator rule. */
const USER_METHODS_REFUSED = new Set(["updateMany", "delete", "deleteMany"]);

export interface AdminBackofficeServiceOptions {
  repository: AdminBackofficeRepository;
  users: UserApi;
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
type UserSideEffectAudit = { action: string; payload: Record<string, unknown> };

export class AdminBackofficeService {
  private readonly repository: AdminBackofficeRepository;
  private readonly users: UserApi;
  private readonly audit: AdminAuditSink;
  private readonly ssoRouting: OrganizationSsoRouting;

  private constructor(deps: {
    repository: AdminBackofficeRepository;
    users: UserApi;
    audit: AdminAuditSink;
    ssoRouting: OrganizationSsoRouting;
  }) {
    this.repository = deps.repository;
    this.users = deps.users;
    this.audit = deps.audit;
    this.ssoRouting = deps.ssoRouting;
  }

  static create(options: AdminBackofficeServiceOptions): AdminBackofficeService {
    return new AdminBackofficeService({
      repository: options.repository,
      users: options.users,
      audit: options.audit,
      ssoRouting: options.ssoRouting ?? STRINGS_STILL_DECIDE,
    });
  }

  async execute(input: AdminOperationInput): Promise<AdminOperationResult> {
    const parsed = adminOperationInputSchema.parse(input);
    if (parsed.resource === "user" && USER_METHODS_REFUSED.has(parsed.method)) {
      throw new ValidationError("The admin API does not bulk-update or delete users", {
        meta: { fieldErrors: { method: ["Deactivate users one at a time instead."] } },
      });
    }
    if (
      parsed.resource === "user" &&
      parsed.method === "create" &&
      "deactivatedAt" in (parsed.params.data ?? {})
    ) {
      throw new ValidationError("A new account starts active", {
        meta: { fieldErrors: { deactivatedAt: ["Create the account, then deactivate it."] } },
      });
    }
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
    const userId = String(input.params.id ?? "");
    const sideEffectAudits: UserSideEffectAudit[] = [];

    if ("deactivatedAt" in data) {
      sideEffectAudits.push(
        await this.applyDeactivation({
          userId,
          actorId: input.actorId,
          value: data.deactivatedAt,
        }),
      );
      delete data.deactivatedAt;
    }

    if ("email" in data && typeof data.email === "string") {
      sideEffectAudits.push(await this.applyEmailChange({ userId, email: data.email }));
      delete data.email;
    }

    for (const entry of sideEffectAudits) {
      await this.audit.record({
        userId: input.actorId,
        action: `admin/${entry.action}`,
        args: entry.payload,
        req: input.req,
      });
    }

    if (sideEffectAudits.length > 0 && Object.keys(data).length === 0) {
      return this.repository.findUserById(userId);
    }

    const normalized: AdminOperationInput = {
      ...input,
      params: { ...input.params, data },
    };
    const result = await this.repository.execute(normalized);
    await this.auditMutation(normalized, result);

    return result;
  }

  /**
   * Reactivates on a blank value, deactivates on a date; any other value is refused.
   * Both go through user's lifecycle, which stamps the database's clock, so a picked date is
   * not kept: the fact names the operator as its actor.
   */
  private async applyDeactivation({
    userId,
    actorId,
    value,
  }: {
    userId: string;
    actorId: string;
    value: unknown;
  }): Promise<UserSideEffectAudit> {
    const actor: LedgerActor = { type: "user", id: actorId };
    if (value === null || value === "") {
      await this.users.reactivate({ id: userId, actor });
      return { action: "update/user", payload: { id: userId, reactivate: true } };
    }
    if (typeof value !== "string" && !(value instanceof Date)) {
      throw new ValidationError("Unreadable deactivation", {
        meta: {
          fieldErrors: { deactivatedAt: ["Send a date to deactivate, or null to reactivate."] },
        },
      });
    }

    await this.users.deactivate({ id: userId, actor });
    return { action: "update/user", payload: { id: userId, deactivate: true } };
  }

  /** Saves the normalised email; user signs the user out of every browser on a real change. */
  private async applyEmailChange({
    userId,
    email: rawEmail,
  }: {
    userId: string;
    email: string;
  }): Promise<UserSideEffectAudit> {
    const email = rawEmail.trim().toLowerCase();
    await this.users.updateProfile({ id: userId, email });
    return { action: "update/user", payload: { id: userId, email } };
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
