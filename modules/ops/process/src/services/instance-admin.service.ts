import type { AuthApi } from "@langwatch/auth-contract";
import type { LedgerActor } from "@langwatch/authorization";
import { ValidationError } from "@langwatch/handled-error";
import { SsoConnectionStringEditRetiredError } from "@langwatch/identity-contract";
import {
  ORGANIZATION_DATASET_ATTACHMENT_MAX_MB_REFUSAL,
  adminOperationInputSchema,
  type AdminOperationInput,
  type AdminOperationResult,
} from "@langwatch/ops-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ShareApi } from "@langwatch/share-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { InstanceAdminRepository } from "../repositories/instance-admin.repository.ts";
import { legacySsoStringWritesToRefuse } from "../rules/legacy-sso-string-writes.rules.ts";
import { isOrganizationDatasetLimitWriteAllowed } from "../rules/organization-dataset-limit.rules.ts";
import type { AdminAccess } from "./admin-access.service.ts";
import type { AdminAuditSink } from "./impersonation.service.ts";

const MUTATING_METHODS = new Set(["create", "update", "updateMany", "delete", "deleteMany"]);
/** User writes that would skip the user module's facts and last-operator rule. */
const USER_METHODS_REFUSED = new Set(["updateMany", "delete", "deleteMany"]);

/** Asked as impersonation asks it: an operator's account is never a Back office target. */
type InstanceAdminOperators = Pick<AdminAccess, "isAdmin">;
/** Auth's account doors: each writes through user, then ends the credentials it outdates. */
export type InstanceAdminAccounts = Pick<AuthApi, "deactivateUser" | "changeUserEmail">;
/** Project's one door for its sharing switch, so share hears the fact it revokes from. */
type InstanceAdminProjects = Pick<ProjectApi, "setTraceSharing">;
export type InstanceAdminShares = Pick<ShareApi, "countTraceShares">;

interface InstanceAdminServiceOptions {
  repository: InstanceAdminRepository;
  users: UserApi;
  accounts: InstanceAdminAccounts;
  operators: InstanceAdminOperators;
  /** Absent only where no sharing switch is edited; a switch then refuses by name. */
  projects?: InstanceAdminProjects | undefined;
  shares?: InstanceAdminShares | undefined;
  audit: AdminAuditSink;
  /** Whether an organization's own connection decides its sign-in, asked of
   *  the module that owns connections. */
  ssoRouting?: OrganizationSsoRouting | undefined;
  /** Where only staff operate, an operator's address is fixed; elsewhere they change their own. */
  operatorAddressesFixed?: boolean | undefined;
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

const NO_SHARING_DOOR: InstanceAdminProjects & InstanceAdminShares = {
  setTraceSharing: () => Promise.reject(new Error("instance admin composed without project")),
  countTraceShares: () => Promise.reject(new Error("instance admin composed without share")),
};

/** Ops-owned application service for the legacy react-admin wire surface. */
type UserSideEffectAudit = { action: string; payload: Record<string, unknown> };

export class InstanceAdminService {
  private readonly repository: InstanceAdminRepository;
  private readonly users: UserApi;
  private readonly accounts: InstanceAdminAccounts;
  private readonly operators: InstanceAdminOperators;
  private readonly projects: InstanceAdminProjects;
  private readonly shares: InstanceAdminShares;
  private readonly audit: AdminAuditSink;
  private readonly ssoRouting: OrganizationSsoRouting;
  private readonly operatorAddressesFixed: boolean;

  private constructor(deps: {
    repository: InstanceAdminRepository;
    users: UserApi;
    accounts: InstanceAdminAccounts;
    operators: InstanceAdminOperators;
    projects: InstanceAdminProjects;
    shares: InstanceAdminShares;
    audit: AdminAuditSink;
    ssoRouting: OrganizationSsoRouting;
    operatorAddressesFixed: boolean;
  }) {
    this.repository = deps.repository;
    this.users = deps.users;
    this.accounts = deps.accounts;
    this.operators = deps.operators;
    this.projects = deps.projects;
    this.shares = deps.shares;
    this.audit = deps.audit;
    this.ssoRouting = deps.ssoRouting;
    this.operatorAddressesFixed = deps.operatorAddressesFixed;
  }

  static create(options: InstanceAdminServiceOptions): InstanceAdminService {
    return new InstanceAdminService({
      repository: options.repository,
      users: options.users,
      accounts: options.accounts,
      operators: options.operators,
      projects: options.projects ?? NO_SHARING_DOOR,
      shares: options.shares ?? NO_SHARING_DOOR,
      audit: options.audit,
      ssoRouting: options.ssoRouting ?? STRINGS_STILL_DECIDE,
      operatorAddressesFixed: options.operatorAddressesFixed ?? true,
    });
  }

  async execute(input: AdminOperationInput): Promise<AdminOperationResult> {
    const parsed = adminOperationInputSchema.parse(input);
    if (parsed.resource === "user") await this.refuseUserWrite(parsed);
    if (
      "traceSharingEnabled" in (parsed.params.data ?? {}) &&
      !(parsed.resource === "project" && ["create", "update"].includes(parsed.method))
    ) {
      throw new ValidationError("Trace sharing is switched one project at a time", {
        meta: {
          fieldErrors: { traceSharingEnabled: ["Edit each project, so its links are handled."] },
        },
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

    this.refuseOutOfRangeDatasetLimit(parsed);
    const normalized = await this.normalizeOrganizationDomain(parsed);
    await this.auditMutation(normalized);

    if (normalized.resource === "project" && normalized.method === "update") {
      return this.updateProject(normalized);
    }
    if (normalized.resource === "project" && normalized.method === "getOne") {
      return this.projectWithTraceShareCount(normalized);
    }

    return this.repository.execute(normalized);
  }

  /** The sharing switch goes through project's door; every other field stays a generic write. */
  private async updateProject(input: AdminOperationInput): Promise<AdminOperationResult> {
    const { traceSharingEnabled, revokeExistingLinks, ...data } = input.params.data ?? {};
    const projectId = String(input.params.id ?? "");
    if (typeof traceSharingEnabled === "boolean") {
      await this.projects.setTraceSharing({
        projectId,
        enabled: traceSharingEnabled,
        revokeExistingLinks: revokeExistingLinks !== false,
        by: { id: input.actorId },
      });
    }
    if (Object.keys(data).length > 0) {
      return this.repository.execute({ ...input, params: { ...input.params, data } });
    }

    return this.repository.execute({ ...input, method: "getOne", params: { id: projectId } });
  }

  /** The edit drawer asks this before sharing is switched off, to offer revoking the links. */
  private async projectWithTraceShareCount(
    input: AdminOperationInput,
  ): Promise<AdminOperationResult> {
    const result = await this.repository.execute(input);
    if (!("data" in result) || result.data === null || typeof result.data !== "object") {
      return result;
    }
    const traceShareLinkCount = await this.shares.countTraceShares({
      projectId: String(input.params.id ?? ""),
    });

    return { ...result, data: { ...result.data, traceShareLinkCount } };
  }

  /**
   * Every audit entry is recorded before the first write, so a failed audit leaves
   * nothing applied.
   */
  private async updateUser(input: AdminOperationInput): Promise<AdminOperationResult> {
    const data = { ...input.params.data };
    const userId = String(input.params.id ?? "");
    const actor: LedgerActor = { type: "user", id: input.actorId };
    const sideEffectAudits: UserSideEffectAudit[] = [];

    const lifecycle = "deactivatedAt" in data ? this.lifecycleChange(data.deactivatedAt) : null;
    delete data.deactivatedAt;
    if (lifecycle) {
      sideEffectAudits.push({ action: "update/user", payload: { id: userId, [lifecycle]: true } });
    }

    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : null;
    if (email !== null) {
      delete data.email;
      sideEffectAudits.push({ action: "update/user", payload: { id: userId, email } });
    }

    const saved: AdminOperationInput = { ...input, params: { ...input.params, data } };
    const savesFields = sideEffectAudits.length === 0 || Object.keys(data).length > 0;
    for (const entry of sideEffectAudits) {
      await this.audit.record({
        userId: input.actorId,
        action: `admin/${entry.action}`,
        args: entry.payload,
        req: input.req,
      });
    }
    if (savesFields) await this.auditMutation(saved);

    if (lifecycle === "reactivate") await this.users.reactivate({ id: userId, actor });
    if (lifecycle === "deactivate") await this.accounts.deactivateUser({ id: userId, actor });
    // auth signs the account out of every browser on a real change.
    if (email !== null) await this.accounts.changeUserEmail({ id: userId, email });

    return savesFields ? this.repository.execute(saved) : this.repository.findUserById(userId);
  }

  /**
   * Reactivates on a blank value, deactivates on a date; any other value is refused.
   * Both go through user's lifecycle, which stamps the database's clock, so a picked date is
   * not kept: the fact names the operator as its actor.
   */
  private lifecycleChange(value: unknown): "reactivate" | "deactivate" {
    if (value === null || value === "") return "reactivate";
    if (typeof value !== "string" && !(value instanceof Date)) {
      throw new ValidationError("Unreadable deactivation", {
        meta: {
          fieldErrors: { deactivatedAt: ["Send a date to deactivate, or null to reactivate."] },
        },
      });
    }

    return "deactivate";
  }

  /** The user writes the Back office never makes, each refused before anything is audited. */
  private async refuseUserWrite(input: AdminOperationInput): Promise<void> {
    const data = input.params.data ?? {};
    if (USER_METHODS_REFUSED.has(input.method)) {
      throw new ValidationError("The admin API does not bulk-update or delete users", {
        meta: { fieldErrors: { method: ["Deactivate users one at a time instead."] } },
      });
    }
    if (input.method === "create" && "deactivatedAt" in data) {
      throw new ValidationError("A new account starts active", {
        meta: { fieldErrors: { deactivatedAt: ["Create the account, then deactivate it."] } },
      });
    }
    if ("emailVerified" in data) {
      throw new ValidationError("An address is verified by its owner", {
        meta: {
          fieldErrors: {
            emailVerified: ["Verification is not set by hand; a new address clears it."],
          },
        },
      });
    }
    await this.refuseOperatorAccount(input);
  }

  /**
   * Operators manage each other on the Operators page; the grant is revoked there first. Where
   * operating is not kept to staff, an operator may still change their own address.
   */
  private async refuseOperatorAccount(input: AdminOperationInput): Promise<void> {
    if (!MUTATING_METHODS.has(input.method) || input.params.id === undefined) return;
    if (this.isOwnAddressChange(input)) return;
    if (!(await this.operators.isAdmin({ id: String(input.params.id) }))) return;

    throw new ValidationError("An operator's account is not edited in the Back office", {
      meta: { fieldErrors: { id: ["Revoke the operator on the Operators page first."] } },
    });
  }

  private isOwnAddressChange(input: AdminOperationInput): boolean {
    const fields = Object.keys(input.params.data ?? {});
    return (
      !this.operatorAddressesFixed &&
      input.method === "update" &&
      String(input.params.id) === input.actorId &&
      fields.length === 1 &&
      fields[0] === "email"
    );
  }

  /** Refused before the audit entry, so a refused write leaves nothing recorded. */
  private refuseOutOfRangeDatasetLimit(input: AdminOperationInput): void {
    if (input.resource !== "organization" || !MUTATING_METHODS.has(input.method)) return;

    if (isOrganizationDatasetLimitWriteAllowed(input.params.data)) return;

    throw new ValidationError("The max dataset file size is outside the allowed range", {
      meta: {
        fieldErrors: { datasetAttachmentMaxMb: [ORGANIZATION_DATASET_ATTACHMENT_MAX_MB_REFUSAL] },
      },
    });
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

  /** Records the intended change before it is written; a create names no id yet. */
  private async auditMutation(input: AdminOperationInput): Promise<void> {
    if (!MUTATING_METHODS.has(input.method)) {
      return;
    }

    const params = input.params;
    if (input.method === "updateMany" || input.method === "deleteMany") {
      for (const id of this.stringArray(params.ids)) {
        await this.recordMutationAudit(input, id);
      }

      return;
    }

    await this.recordMutationAudit(input, params.id === undefined ? undefined : String(params.id));
  }

  private async recordMutationAudit(
    input: AdminOperationInput,
    id: string | undefined,
  ): Promise<void> {
    const payload: Record<string, unknown> = id === undefined ? {} : { id };
    const { data, previousData } = input.params;
    if (data) {
      payload.data = data;
      // Only the prior values of the fields being changed; never the whole row.
      if (previousData) {
        payload.previousData = Object.fromEntries(
          Object.entries(previousData).filter(([key]) => Object.hasOwn(data, key)),
        );
      }
    }

    await this.audit.record({
      userId: input.actorId,
      action: `admin/${this.auditAction(input.method)}/${input.resource}`,
      args: payload,
      req: input.req,
    });
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

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
  }
}
