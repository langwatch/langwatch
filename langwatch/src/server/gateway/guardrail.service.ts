/**
 * GatewayGuardrail CRUD service.
 *
 * GatewayGuardrail is a project-scoped first-class resource: one row per
 * (project, evaluator, direction). VKs reference it by id from
 * `vk.config.guardrailAttachments[]`. The flat per-project catalog ships
 * in the bundle; the Go dispatcher reads `guardrail_attachments` to know
 * which `guardrails[]` to invoke per direction.
 *
 * Spec: specs/ai-gateway/governance/guardrails-project-scope.feature
 */
import type {
  GatewayGuardrail,
  GatewayGuardrailDirection,
  GatewayGuardrailFailureMode,
  PrismaClient,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { GatewayAuditAdapter } from "./auditLog.repository";
import { serializeRowForAudit } from "./auditSerializer";

export type CreateGuardrailInput = {
  projectId: string;
  name: string;
  description?: string | null;
  evaluatorId: string;
  direction: GatewayGuardrailDirection;
  failureMode?: GatewayGuardrailFailureMode;
  actorUserId: string;
};

export type UpdateGuardrailInput = {
  id: string;
  projectId: string;
  name?: string;
  description?: string | null;
  evaluatorId?: string;
  direction?: GatewayGuardrailDirection;
  failureMode?: GatewayGuardrailFailureMode;
  actorUserId: string;
};

export type ArchiveGuardrailInput = {
  id: string;
  projectId: string;
  actorUserId: string;
};

export class GatewayGuardrailService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditLog = new GatewayAuditAdapter(prisma),
  ) {}

  static create(prisma: PrismaClient): GatewayGuardrailService {
    return new GatewayGuardrailService(prisma);
  }

  async list(projectId: string): Promise<GatewayGuardrail[]> {
    return this.prisma.gatewayGuardrail.findMany({
      where: { projectId, archivedAt: null },
      orderBy: [{ direction: "asc" }, { name: "asc" }],
    });
  }

  async get(id: string, projectId: string): Promise<GatewayGuardrail | null> {
    return this.prisma.gatewayGuardrail.findFirst({
      where: { id, projectId, archivedAt: null },
    });
  }

  async create(input: CreateGuardrailInput): Promise<GatewayGuardrail> {
    await this.assertEvaluatorInProject(input.evaluatorId, input.projectId);
    const row = await this.prisma.gatewayGuardrail.create({
      data: {
        projectId: input.projectId,
        name: input.name,
        description: input.description ?? null,
        evaluatorId: input.evaluatorId,
        direction: input.direction,
        failureMode: input.failureMode ?? "FAIL_CLOSED",
        createdById: input.actorUserId,
        updatedById: input.actorUserId,
      },
    });
    await this.auditLog.append({
      organizationId: await this.resolveOrgId(input.projectId),
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      action: "gateway.guardrail.created",
      targetKind: "guardrail",
      targetId: row.id,
      after: serializeRowForAudit(row),
    });
    return row;
  }

  async update(input: UpdateGuardrailInput): Promise<GatewayGuardrail> {
    const existing = await this.requireOwn(input.id, input.projectId);
    if (
      input.evaluatorId !== undefined &&
      input.evaluatorId !== existing.evaluatorId
    ) {
      await this.assertEvaluatorInProject(input.evaluatorId, input.projectId);
    }
    const row = await this.prisma.gatewayGuardrail.update({
      where: { id: existing.id },
      data: {
        name: input.name ?? undefined,
        description:
          input.description === undefined ? undefined : input.description,
        evaluatorId: input.evaluatorId ?? undefined,
        direction: input.direction ?? undefined,
        failureMode: input.failureMode ?? undefined,
        updatedById: input.actorUserId,
      },
    });
    await this.auditLog.append({
      organizationId: await this.resolveOrgId(input.projectId),
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      action: "gateway.guardrail.updated",
      targetKind: "guardrail",
      targetId: row.id,
      before: serializeRowForAudit(existing),
      after: serializeRowForAudit(row),
    });
    return row;
  }

  async archive(input: ArchiveGuardrailInput): Promise<void> {
    const existing = await this.requireOwn(input.id, input.projectId);
    await this.prisma.gatewayGuardrail.update({
      where: { id: existing.id },
      data: { archivedAt: new Date(), updatedById: input.actorUserId },
    });
    await this.auditLog.append({
      organizationId: await this.resolveOrgId(input.projectId),
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      action: "gateway.guardrail.archived",
      targetKind: "guardrail",
      targetId: existing.id,
      before: serializeRowForAudit(existing),
    });
  }

  private async requireOwn(
    id: string,
    projectId: string,
  ): Promise<GatewayGuardrail> {
    const row = await this.prisma.gatewayGuardrail.findFirst({
      where: { id, projectId, archivedAt: null },
    });
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return row;
  }

  private async assertEvaluatorInProject(
    evaluatorId: string,
    projectId: string,
  ): Promise<void> {
    const evaluator = await this.prisma.evaluator.findFirst({
      where: { id: evaluatorId, projectId, archivedAt: null },
      select: { id: true },
    });
    if (!evaluator) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Evaluator not found in this project",
      });
    }
    // executionMode=AS_GUARDRAIL lives on Monitor (the eval execution
    // surface), not Evaluator. A guardrail-eligible evaluator is one
    // with at least one enabled Monitor row in the same project whose
    // executionMode is AS_GUARDRAIL. Without this gate, an operator
    // could bind any evaluator the gateway is not authorised to invoke
    // synchronously, per spec guardrails-project-scope.feature L46-49.
    const monitorRow = await this.prisma.monitor.findFirst({
      where: {
        evaluatorId,
        projectId,
        executionMode: "AS_GUARDRAIL",
        enabled: true,
      },
      select: { id: true },
    });
    if (!monitorRow) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Evaluator must have at least one enabled Monitor with executionMode = AS_GUARDRAIL in this project (code: evaluator_not_as_guardrail)",
      });
    }
  }

  private async resolveOrgId(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    if (!project?.team) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Project not found",
      });
    }
    return project.team.organizationId;
  }
}
