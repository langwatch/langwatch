import type { EvaluatorService } from "@langwatch/evaluator-contract";
import {
  archiveGatewayGuardrailInputSchema,
  createGatewayGuardrailInputSchema,
  GatewayGuardrailEvaluatorInvalidError,
  GatewayGuardrailNotFoundError,
  GatewayGuardrailProjectNotFoundError,
  updateGatewayGuardrailInputSchema,
  type ArchiveGatewayGuardrailInput,
  type CreateGatewayGuardrailInput,
  type GatewayGuardrailResource,
  type GatewayGuardrailBundleEntry,
  type UpdateGatewayGuardrailInput,
} from "@langwatch/gateway-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { GatewayAuditPort } from "../ports/gateway-audit.port";
import { GatewayGuardrailRepository } from "../repositories/gateway-guardrail.repository";
import { serializeRowForAudit } from "../adapters/gateway-audit-serializer.adapter";

/** Private guardrail catalogue collaborator owned by the singular Gateway service. */
export class GatewayGuardrailCatalogue {
  static create(input: {
    repository: GatewayGuardrailRepository;
    evaluators: EvaluatorService;
    monitors: MonitorService;
    projects: ProjectService;
    audit: GatewayAuditPort;
  }): GatewayGuardrailCatalogue {
    return new GatewayGuardrailCatalogue(
      input.repository,
      input.evaluators,
      input.monitors,
      input.projects,
      input.audit,
    );
  }

  private constructor(
    private readonly repository: GatewayGuardrailRepository,
    private readonly evaluators: EvaluatorService,
    private readonly monitors: MonitorService,
    private readonly projects: ProjectService,
    private readonly audit: GatewayAuditPort,
  ) {}

  list(projectId: string): Promise<GatewayGuardrailResource[]> {
    return this.repository.list(projectId);
  }

  listBundleEntries(projectId: string): Promise<GatewayGuardrailBundleEntry[]> {
    return this.repository.listBundleEntries(projectId);
  }

  tryGet(input: { id: string; projectId: string }): Promise<GatewayGuardrailResource | null> {
    return this.repository.tryGet(input);
  }

  async create(input: CreateGatewayGuardrailInput): Promise<GatewayGuardrailResource> {
    const parsed = createGatewayGuardrailInputSchema.parse(input);
    await this.assertEvaluatorEligible(parsed.evaluatorId, parsed.projectId);
    const row = await this.repository.create(parsed);
    await this.audit.append({
      organizationId: await this.organizationIdFor(parsed.projectId),
      projectId: parsed.projectId,
      actorUserId: parsed.actorUserId,
      action: "gateway.guardrail.created",
      targetKind: "guardrail",
      targetId: row.id,
      after: serializeRowForAudit(row),
    });
    return row;
  }

  async update(input: UpdateGatewayGuardrailInput): Promise<GatewayGuardrailResource> {
    const parsed = updateGatewayGuardrailInputSchema.parse(input);
    const existing = await this.repository.tryGet({
      id: parsed.id,
      projectId: parsed.projectId,
    });
    if (!existing) {
      throw new GatewayGuardrailNotFoundError();
    }
    if (parsed.evaluatorId !== undefined && parsed.evaluatorId !== existing.evaluatorId) {
      await this.assertEvaluatorEligible(parsed.evaluatorId, parsed.projectId);
    }
    const row = await this.repository.update(parsed);
    await this.audit.append({
      organizationId: await this.organizationIdFor(parsed.projectId),
      projectId: parsed.projectId,
      actorUserId: parsed.actorUserId,
      action: "gateway.guardrail.updated",
      targetKind: "guardrail",
      targetId: row.id,
      before: serializeRowForAudit(existing),
      after: serializeRowForAudit(row),
    });
    return row;
  }

  async archive(input: ArchiveGatewayGuardrailInput): Promise<void> {
    const parsed = archiveGatewayGuardrailInputSchema.parse(input);
    const existing = await this.repository.tryGet({
      id: parsed.id,
      projectId: parsed.projectId,
    });
    if (!existing) {
      throw new GatewayGuardrailNotFoundError();
    }
    await this.repository.archive(parsed);
    await this.audit.append({
      organizationId: await this.organizationIdFor(parsed.projectId),
      projectId: parsed.projectId,
      actorUserId: parsed.actorUserId,
      action: "gateway.guardrail.archived",
      targetKind: "guardrail",
      targetId: existing.id,
      before: serializeRowForAudit(existing),
    });
  }

  private async assertEvaluatorEligible(evaluatorId: string, projectId: string): Promise<void> {
    const evaluator = await this.evaluators.tryGetById({ id: evaluatorId, projectId });
    if (!evaluator) {
      throw new GatewayGuardrailEvaluatorInvalidError();
    }
    const monitors = await this.monitors.listEnabledGuardrailMonitors({
      projectId,
      evaluatorIds: [evaluatorId],
    });
    if (monitors.length === 0) {
      throw new GatewayGuardrailEvaluatorInvalidError();
    }
  }

  private async organizationIdFor(projectId: string): Promise<string> {
    const project = await this.projects.tryGetWithTeam(projectId);
    if (!project) {
      throw new GatewayGuardrailProjectNotFoundError();
    }
    return project.team.organizationId;
  }
}
