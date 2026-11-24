import { createHash } from "node:crypto";

import {
  GatewayA2aTargetHeadersNeedReplacingError,
  GatewayA2aTargetNameTakenError,
  GatewayA2aTargetNotFoundError,
  createGatewayA2aTargetInputSchema,
  updateGatewayA2aTargetInputSchema,
  type CreateGatewayA2aTargetInput,
  type GatewayA2aTargetResource,
  type GatewayA2aTargetWire,
  type UpdateGatewayA2aTargetInput,
} from "@langwatch/gateway-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type {
  GatewayA2aTargetRepository,
  GatewayA2aTargetUpdate,
} from "../repositories/gateway-a2a-target.repository.ts";
import type {
  GatewayAuditAction,
  GatewayAuditRepository,
} from "../repositories/gateway-audit.repository.ts";
import type {
  GatewayChangeEventKind,
  GatewayChangeEventsRepository,
} from "../repositories/gateway-change-event.repository.ts";
import type {
  GatewayPersistenceTransaction,
  GatewayTransactionRepository,
} from "../repositories/gateway-transaction.repository.ts";
import {
  a2aTargetAdmitsKey,
  a2aTargetToDto,
  a2aTargetsForProject,
} from "../rules/gateway-a2a-target.rules.ts";
import { assertProjectInOrganization } from "../rules/gateway-project-scope.rules.ts";

type GatewayA2aTargetServiceDependencies = {
  repository: GatewayA2aTargetRepository;
  changeEvents: GatewayChangeEventsRepository;
  auditLog: GatewayAuditRepository;
  /** Where a project-scoped target's project is checked against the target's organization. */
  projects: Pick<ProjectApi, "findWithTeam">;
  transactions: GatewayTransactionRepository;
};

/** The A2A target registry: one name per scope (org-wide or one project). */
export class GatewayA2aTargetService {
  static create(input: GatewayA2aTargetServiceDependencies): GatewayA2aTargetService {
    return new GatewayA2aTargetService(input);
  }

  private readonly repository: GatewayA2aTargetRepository;
  private readonly changeEvents: GatewayChangeEventsRepository;
  private readonly auditLog: GatewayAuditRepository;
  private readonly projects: Pick<ProjectApi, "findWithTeam">;
  private readonly transactions: GatewayTransactionRepository;

  private constructor(input: GatewayA2aTargetServiceDependencies) {
    this.repository = input.repository;
    this.changeEvents = input.changeEvents;
    this.auditLog = input.auditLog;
    this.projects = input.projects;
    this.transactions = input.transactions;
  }

  /**
   * Writes the target, bumps the change feed so gateways refetch, and audits the write, all in
   * one transaction. The audit rows carry the DTO: header names, never their values.
   */
  private announce(input: {
    kind: GatewayChangeEventKind;
    action: GatewayAuditAction;
    actorUserId: string;
    before: GatewayA2aTargetResource | null;
    write: (transaction: GatewayPersistenceTransaction) => Promise<GatewayA2aTargetResource>;
  }): Promise<GatewayA2aTargetResource> {
    return this.transactions.run(async (transaction) => {
      const target = await input.write(transaction);
      await this.changeEvents.append(
        {
          organizationId: target.organizationId,
          projectId: target.projectId,
          kind: input.kind,
          payload: { a2aTargetId: target.id },
        },
        transaction,
      );
      await this.auditLog.append(
        {
          organizationId: target.organizationId,
          projectId: target.projectId,
          actorUserId: input.actorUserId,
          action: input.action,
          targetKind: "a2a_target",
          targetId: target.id,
          before: input.before ? a2aTargetToDto(input.before) : null,
          after: a2aTargetToDto(target),
        },
        transaction,
      );
      return target;
    });
  }

  /** Unseals headers: the DTO every list ends at names them, and drops their values. */
  list(organizationId: string): Promise<GatewayA2aTargetResource[]> {
    return this.repository.findAll(organizationId);
  }

  listForProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<GatewayA2aTargetResource[]> {
    return this.repository.findByProject(input);
  }

  async updateForProject(
    input: UpdateGatewayA2aTargetInput & { projectId: string },
  ): Promise<GatewayA2aTargetResource> {
    const { projectId, ...update } = input;
    await this.requireProjectTarget({ ...update, projectId });
    return this.update(update);
  }

  async setBlockedForProject(input: {
    id: string;
    organizationId: string;
    projectId: string;
    blocked: boolean;
    blockReason: string | null;
    actorUserId: string;
  }): Promise<GatewayA2aTargetResource> {
    const { projectId, ...blocked } = input;
    await this.requireProjectTarget({ ...blocked, projectId });
    return this.setBlocked(blocked);
  }

  async archiveForProject(input: {
    id: string;
    organizationId: string;
    projectId: string;
    actorUserId: string;
  }): Promise<GatewayA2aTargetResource> {
    await this.requireProjectTarget(input);
    return this.archive({
      id: input.id,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
    });
  }

  /** Another project's target and an org-wide one read as not found to a project admin. */
  private async requireProjectTarget(input: {
    id: string;
    organizationId: string;
    projectId: string;
  }): Promise<void> {
    const target = await this.repository.findById(input);
    if (!target || target.projectId !== input.projectId) throw new GatewayA2aTargetNotFoundError();
  }

  async create(input: CreateGatewayA2aTargetInput): Promise<GatewayA2aTargetResource> {
    const parsed = createGatewayA2aTargetInputSchema.parse(input);
    if (parsed.projectId !== null) {
      const project = await this.projects.findWithTeam(parsed.projectId);
      assertProjectInOrganization({ project, organizationId: parsed.organizationId });
    }
    const existing = await this.repository.findAll(parsed.organizationId, { headers: false });
    if (existing.some((t) => t.name === parsed.name && t.projectId === parsed.projectId)) {
      throw new GatewayA2aTargetNameTakenError(parsed.name);
    }
    return this.announce({
      kind: "A2A_TARGET_CREATED",
      action: "gateway.a2a_target.created",
      actorUserId: parsed.actorUserId,
      before: null,
      write: (tx) => this.repository.create(parsed, tx),
    });
  }

  update(input: UpdateGatewayA2aTargetInput): Promise<GatewayA2aTargetResource> {
    return this.write(input, "gateway.a2a_target.updated");
  }

  private async write(
    input: UpdateGatewayA2aTargetInput,
    action: GatewayAuditAction,
  ): Promise<GatewayA2aTargetResource> {
    const parsed = updateGatewayA2aTargetInputSchema.parse(input);
    const before = await this.repository.findById(parsed);
    if (!before) throw new GatewayA2aTargetNotFoundError();
    if (
      headersLeftBehind({
        before,
        upstreamUrl: parsed.upstreamUrl,
        headers: parsed.upstreamHeaders,
      })
    ) {
      throw new GatewayA2aTargetHeadersNeedReplacingError();
    }
    return this.announce({
      kind: "A2A_TARGET_UPDATED",
      action,
      actorUserId: parsed.actorUserId,
      before,
      write: (tx) => this.repository.update(guardedUpdate({ before, edit: parsed }), tx),
    });
  }

  async archive(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<GatewayA2aTargetResource> {
    const before = await this.repository.findById(input);
    if (!before) throw new GatewayA2aTargetNotFoundError();
    const ref = { id: input.id, organizationId: input.organizationId };
    return this.announce({
      kind: "A2A_TARGET_DELETED",
      action: "gateway.a2a_target.archived",
      actorUserId: input.actorUserId,
      before,
      write: (tx) => this.repository.archive(ref, tx),
    });
  }

  /** The bundle's `a2a_targets`: the key's project and org-wide targets the key may call. */
  async bundleFor(input: {
    organizationId: string;
    projectId: string | null;
    virtualKeyId: string;
  }): Promise<GatewayA2aTargetWire[]> {
    const targets = await this.repository.findAll(input.organizationId);
    return a2aTargetsForProject({ targets, projectId: input.projectId }).filter((target) =>
      a2aTargetAdmitsKey({ target, virtualKeyId: input.virtualKeyId }),
    );
  }

  /** Changes whenever a target the key's bundle carries changes, for the config version token. */
  async bundleFingerprint(input: {
    organizationId: string;
    projectId: string | null;
    virtualKeyId: string;
  }): Promise<string> {
    // Header values stay sealed: a header edit moves `updatedAt`, which is hashed.
    const targets = await this.repository.findAll(input.organizationId, { headers: false });
    const wire = a2aTargetsForProject({ targets, projectId: input.projectId }).filter((target) =>
      a2aTargetAdmitsKey({ target, virtualKeyId: input.virtualKeyId }),
    );
    if (wire.length === 0) return "";
    const names = new Set(wire.map((target) => target.name));
    const versions = targets
      .filter((target) => names.has(target.name))
      .map((target) => [target.id, target.updatedAt.toISOString()]);
    return createHash("sha256")
      .update(JSON.stringify({ wire, versions }))
      .digest("hex")
      .slice(0, 16);
  }

  async setBlocked(input: {
    id: string;
    organizationId: string;
    blocked: boolean;
    blockReason: string | null;
    actorUserId: string;
  }): Promise<GatewayA2aTargetResource> {
    return this.write(
      {
        id: input.id,
        organizationId: input.organizationId,
        blocked: input.blocked,
        blockReason: input.blocked ? input.blockReason : null,
        actorUserId: input.actorUserId,
      },
      input.blocked ? "gateway.a2a_target.blocked" : "gateway.a2a_target.unblocked",
    );
  }
}

/** The edit to write: a URL move keeping saved headers lands only on the upstream it checked. */
function guardedUpdate({
  before,
  edit,
}: {
  before: GatewayA2aTargetResource;
  edit: UpdateGatewayA2aTargetInput;
}): GatewayA2aTargetUpdate {
  if (edit.upstreamUrl === undefined || edit.upstreamHeaders !== undefined) return edit;
  return {
    ...edit,
    expectedUpstream: {
      upstreamUrl: before.upstreamUrl,
      hasUpstreamHeaders: Object.keys(before.upstreamHeaders).length > 0,
    },
  };
}

/**
 * Whether an edit would send headers saved for one upstream origin to another. Header values are
 * never shown, so a URL edit alone must not be a way to read them back: a new origin needs a new
 * header set, even an empty one. A path change on the same origin keeps them.
 */
function headersLeftBehind({
  before,
  upstreamUrl,
  headers,
}: {
  before: GatewayA2aTargetResource;
  upstreamUrl: string | undefined;
  headers: Record<string, string> | undefined;
}): boolean {
  if (upstreamUrl === undefined || headers !== undefined) return false;
  if (Object.keys(before.upstreamHeaders).length === 0) return false;
  return new URL(upstreamUrl).origin !== new URL(before.upstreamUrl).origin;
}
