import type { RestAuditRow, RestAuditSink, TrpcAuditSink } from "@langwatch/api/hosting";
import { recordAuditLogCommandSchema, type AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzScopeNotFoundError, type AuthzApi } from "@langwatch/authz-contract";

type ApiDoorAuditPeers = Readonly<{
  authz: Pick<AuthzApi, "getScope">;
  auditLog: Pick<AuditLogApi, "record">;
}>;

/** Where the API door's REST and tRPC audit rows land, each scoped to its organization (E11). */
export class ApiDoorAuditService {
  static create(peers: ApiDoorAuditPeers): ApiDoorAuditService {
    return new ApiDoorAuditService(peers);
  }

  readonly #peers: ApiDoorAuditPeers;

  private constructor(peers: ApiDoorAuditPeers) {
    this.#peers = peers;
  }

  restAudit(): RestAuditSink {
    const audit = this.#peers.auditLog;

    return {
      record: async (row) => {
        const { organizationId, projectId } = await this.#auditScopeOf(row);
        const metadata: Record<string, string> = { channel: "api" };
        if (row.impersonatorId) metadata.impersonatorId = row.impersonatorId;
        if (row.actorId && row.apiKeyId) metadata.apiKeyId = row.apiKeyId;
        await audit.record({
          userId: auditUserIdOf(row),
          action: row.action,
          args: { ...row.params, scope: row.scope },
          projectId,
          organizationId,
          targetId: row.resultId || void 0,
          error: row.errorCode,
          metadata,
          ...(row.impersonatorId ? { actorUserId: row.impersonatorId } : {}),
          ...(row.ipAddress ? { ipAddress: row.ipAddress } : {}),
          ...(row.userAgent ? { userAgent: row.userAgent } : {}),
        });
      },
    };
  }

  trpcAudit(): TrpcAuditSink {
    const audit = this.#peers.auditLog;

    return {
      record: async (entry) => {
        let args: unknown;
        if (entry.args !== void 0) args = JSON.parse(JSON.stringify(entry.args));
        await audit.record(
          recordAuditLogCommandSchema.parse({
            userId: entry.userId,
            action: entry.action,
            args,
            organizationId: entry.organizationId,
            projectId: entry.projectId,
            error: entry.error?.toString(),
            targetKind: entry.targetKind,
            targetId: entry.targetId,
            metadata: { ...entry.metadata, channel: "app" },
            actorUserId: entry.actorUserId,
            ipAddress: entry.ipAddress,
            userAgent: entry.userAgent,
          }),
        );
      },
      organizationOf: async (scope) => (await this.findOrganizationIds(scope))[0] ?? null,
    };
  }

  /** E11: a REST row's organization and project come from its declared scope, else its path. */
  async #auditScopeOf(
    row: RestAuditRow,
  ): Promise<{ organizationId: string | undefined; projectId: string | undefined }> {
    const param = (name: string) =>
      typeof row.params[name] === "string" ? (row.params[name] as string) : void 0;
    const { scope } = row;
    if (scope?.tier === "organization") {
      return { organizationId: scope.id, projectId: param("projectId") };
    }
    if (scope?.tier === "project" || scope?.tier === "team") {
      const organizationId =
        (await this.findOrganizationIds({ tier: scope.tier, id: scope.id }))[0] ??
        param("organizationId");
      const projectId = scope.tier === "project" ? scope.id : param("projectId");
      return { organizationId, projectId };
    }

    return { organizationId: param("organizationId"), projectId: param("projectId") };
  }

  /**
   * The organization holding a project or team, none where authz resolves no such scope. The
   * door's authorization asks this same resolver, so audit rows and access never disagree.
   */
  async findOrganizationIds(scope: { tier: "project" | "team"; id: string }): Promise<string[]> {
    const ids = scope.tier === "project" ? { projectId: scope.id } : { teamId: scope.id };
    const resolved = await this.#peers.authz.getScope(ids).catch((error: unknown) => {
      if (AuthzScopeNotFoundError.is(error)) return null;
      throw error;
    });
    return resolved?.type === scope.tier ? [resolved.organizationId] : [];
  }
}

/**
 * Whom a REST row names (E11): its person, a key acting as nobody as `apikey:<id>` (main's
 * spelling, `managementActor`), else no one.
 */
function auditUserIdOf(row: RestAuditRow): string {
  if (row.actorId) return row.actorId;

  return row.apiKeyId ? `apikey:${row.apiKeyId}` : "anonymous";
}
