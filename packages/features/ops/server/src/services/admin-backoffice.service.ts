import {
  adminOperationInputSchema,
  type AdminDataResult,
  type AdminOperationInput,
  type AdminOperationResult,
  type AdminOperationParams,
} from "@langwatch/ops-contract";
import type { UserService } from "@langwatch/user-contract";
import type { AdminBackofficeRepository } from "../repositories/admin-backoffice.repository";
import type { AdminAuditSink } from "./impersonation.service";

const MUTATING_METHODS = new Set([
  "create",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

export interface AdminBackofficeServiceOptions {
  repository: AdminBackofficeRepository;
  users: UserService;
  audit: AdminAuditSink;
}

/** Ops-owned application service for the legacy react-admin wire surface. */
export class AdminBackofficeService {
  private constructor(
    private readonly repository: AdminBackofficeRepository,
    private readonly users: UserService,
    private readonly audit: AdminAuditSink,
  ) {}

  static create(options: AdminBackofficeServiceOptions): AdminBackofficeService {
    return new AdminBackofficeService(
      options.repository,
      options.users,
      options.audit,
    );
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

    const normalized = this.normalizeOrganizationDomain(parsed);
    const result = await this.repository.execute(normalized);
    await this.auditMutation(normalized, result);
    return result;
  }

  private async updateUser(input: AdminOperationInput): Promise<AdminOperationResult> {
    const data = { ...(input.params.data ?? {}) };
    let handledSideEffect = false;
    const sideEffectAudits: Array<{
      action: string;
      payload: Record<string, unknown>;
    }> = [];

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
        const pickedDate = value instanceof Date ? value : new Date(value);
        const isValidPickedDate = !Number.isNaN(pickedDate.getTime());
        if (isValidPickedDate) {
          await this.repository.setUserDeactivatedAt(userId, pickedDate);
        }
        sideEffectAudits.push({
          action: "update/user",
          payload: {
            id: userId,
            deactivate: true,
            ...(isValidPickedDate
              ? { pickedDate: pickedDate.toISOString() }
              : {}),
          },
        });
      }
    }

    if ("email" in data && typeof data.email === "string") {
      const userId = String(input.params.id ?? "");
      const email = data.email.trim().toLowerCase();
      await this.users.updateProfile({ id: userId, email });
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

  private normalizeOrganizationDomain(
    input: AdminOperationInput,
  ): AdminOperationInput {
    if (
      input.resource !== "organization" ||
      (input.method !== "create" && input.method !== "update")
    ) {
      return input;
    }
    const data = { ...(input.params.data ?? {}) };
    if (typeof data.ssoDomain === "string" && data.ssoDomain.trim() !== "") {
      data.ssoDomain = data.ssoDomain.trim().toLowerCase();
    }
    return { ...input, params: { ...input.params, data } };
  }

  private async auditMutation(
    input: AdminOperationInput,
    result: AdminOperationResult,
  ): Promise<void> {
    if (!MUTATING_METHODS.has(input.method)) return;

    const params = input.params;
    const ids = this.stringArray(params.ids);
    if (input.method === "updateMany" || input.method === "deleteMany") {
      for (const id of ids) {
        await this.recordMutationAudit(input, id);
      }
      return;
    }

    const id = this.operationId(params, result);
    if (id !== null) await this.recordMutationAudit(input, id);
  }

  private async recordMutationAudit(
    input: AdminOperationInput,
    id: string,
  ): Promise<void> {
    const payload: Record<string, unknown> = { id };
    if (input.params.previousData) {
      payload.previousData = input.params.previousData;
    }
    if (input.params.data) payload.data = input.params.data;
    await this.audit.record({
      userId: input.actorId,
      action: `admin/${this.auditAction(input.method)}/${input.resource}`,
      args: payload,
      req: input.req,
    });
  }

  private operationId(
    params: AdminOperationParams,
    result: AdminOperationResult,
  ): string | null {
    if (params.id !== undefined) return String(params.id);
    if (!this.isDataResult(result) || !this.isRecord(result.data)) return null;
    const id = result.data.id;
    return typeof id === "string" || typeof id === "number" ? String(id) : null;
  }

  private isDataResult(result: AdminOperationResult): result is AdminDataResult {
    return !Array.isArray(result.data);
  }

  private auditAction(method: AdminOperationInput["method"]): string {
    if (method === "updateMany") return "update";
    if (method === "deleteMany") return "delete";
    return method;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
  }
}
