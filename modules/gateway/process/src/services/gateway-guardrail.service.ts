import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import {
  GatewayGuardrailEvaluatorInvalidError,
  GatewayGuardrailNotFoundError,
  GatewayGuardrailProjectNotFoundError,
  type ArchiveGatewayGuardrailInput,
  type CreateGatewayGuardrailInput,
  type GatewayGuardrailResource,
  type GatewayGuardrailBundleEntry,
  type UpdateGatewayGuardrailInput,
  serializeRowForAudit,
} from "@langwatch/gateway-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type { GatewayAudit } from "../app/gateway.members.ts";
import type { GatewayGuardrailRepository } from "../repositories/gateway-guardrail.repository.ts";

/** Private guardrail catalogue collaborator owned by the singular Gateway service. */
export class GatewayGuardrailService {
  static create(input: {
    repository: GatewayGuardrailRepository;
    evaluators: EvaluatorApi;
    monitors: MonitorApi;
    projects: ProjectApi;
    audit: GatewayAudit;
  }): GatewayGuardrailService {
    return new GatewayGuardrailService({
      repository: input.repository,
      evaluators: input.evaluators,
      monitors: input.monitors,
      projects: input.projects,
      audit: input.audit,
    });
  }

  private readonly repository: GatewayGuardrailRepository;
  private readonly evaluators: EvaluatorApi;
  private readonly monitors: MonitorApi;
  private readonly projects: ProjectApi;
  private readonly audit: GatewayAudit;

  private constructor({
    repository,
    evaluators,
    monitors,
    projects,
    audit,
  }: {
    repository: GatewayGuardrailRepository;
    evaluators: EvaluatorApi;
    monitors: MonitorApi;
    projects: ProjectApi;
    audit: GatewayAudit;
  }) {
    this.repository = repository;
    this.evaluators = evaluators;
    this.monitors = monitors;
    this.projects = projects;
    this.audit = audit;
  }

  list(projectId: string): Promise<GatewayGuardrailResource[]> {
    return this.repository.findAll(projectId);
  }

  listBundleEntries(projectId: string): Promise<GatewayGuardrailBundleEntry[]> {
    return this.repository.findBundleEntries(projectId);
  }

  findById(input: { id: string; projectId: string }): Promise<GatewayGuardrailResource | null> {
    return this.repository.findById(input);
  }

  async create(input: CreateGatewayGuardrailInput): Promise<GatewayGuardrailResource> {
    await this.assertEvaluatorEligible(input.evaluatorId, input.projectId);
    const row = await this.repository.create(input);
    await this.audit.append({
      organizationId: await this.organizationIdFor(input.projectId),
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      action: "gateway.guardrail.created",
      targetKind: "guardrail",
      targetId: row.id,
      after: serializeRowForAudit(row),
    });

    return row;
  }

  async update(input: UpdateGatewayGuardrailInput): Promise<GatewayGuardrailResource> {
    const existing = await this.repository.findById({
      id: input.id,
      projectId: input.projectId,
    });
    if (!existing) {
      throw new GatewayGuardrailNotFoundError();
    }

    if (input.evaluatorId !== undefined && input.evaluatorId !== existing.evaluatorId) {
      await this.assertEvaluatorEligible(input.evaluatorId, input.projectId);
    }

    const row = await this.repository.update(input);
    await this.audit.append({
      organizationId: await this.organizationIdFor(input.projectId),
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

  async archive(input: ArchiveGatewayGuardrailInput): Promise<void> {
    const existing = await this.repository.findById({
      id: input.id,
      projectId: input.projectId,
    });
    if (!existing) {
      throw new GatewayGuardrailNotFoundError();
    }

    await this.repository.archive(input);
    await this.audit.append({
      organizationId: await this.organizationIdFor(input.projectId),
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      action: "gateway.guardrail.archived",
      targetKind: "guardrail",
      targetId: existing.id,
      before: serializeRowForAudit(existing),
    });
  }

  private async assertEvaluatorEligible(evaluatorId: string, projectId: string): Promise<void> {
    const evaluator = await this.evaluators.findById({ id: evaluatorId, projectId });
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
    const project = await this.projects.findWithTeam(projectId);
    if (!project) {
      throw new GatewayGuardrailProjectNotFoundError();
    }

    return project.team.organizationId;
  }
}
