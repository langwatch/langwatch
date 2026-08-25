import {
  AnnotationAnnotatorInvalidError,
  AnnotationNotFoundError,
  AnnotationProjectNotFoundError,
  AnnotationQueueMemberInvalidError,
  AnnotationScoreInvalidError,
  AnnotationService as AnnotationServiceContract,
  createAnnotationInputSchema,
  deleteAnnotationInputSchema,
  listAnnotationsInputSchema,
  updateAnnotationInputSchema,
  type Annotation,
  type CreateAnnotationInput,
  type DeleteAnnotationInput,
  type ListAnnotationsInput,
  type ProjectionAnnotation,
  type UpdateAnnotationInput,
} from "@langwatch/annotation-contract";
import { AnnotationRepository } from "../ports/annotation.port";

export class AnnotationService extends AnnotationServiceContract {
  private constructor(private readonly repository: AnnotationRepository) {
    super();
  }

  static create(options: { repository: AnnotationRepository }): AnnotationService {
    return new AnnotationService(options.repository);
  }

  create(input: CreateAnnotationInput): Promise<Annotation> {
    return this.repository.create(createAnnotationInputSchema.parse(input));
  }

  update(input: UpdateAnnotationInput): Promise<Annotation> {
    return this.repository.update(updateAnnotationInputSchema.parse(input));
  }

  delete(input: DeleteAnnotationInput): Promise<Annotation> {
    return this.repository.delete(deleteAnnotationInputSchema.parse(input));
  }

  async getById(input: { id: string; projectId: string }): Promise<Annotation> {
    const annotation = await this.repository.tryFindById(input);
    if (!annotation) throw new AnnotationNotFoundError(input.id);
    return annotation;
  }

  list(input: ListAnnotationsInput): Promise<Annotation[]> {
    return this.repository.list(listAnnotationsInputSchema.parse(input));
  }

  listForProjection(input: {
    projectId: string;
    traceIds: string[];
    anchor?: "trace" | "all";
  }): Promise<ProjectionAnnotation[]> {
    return this.repository.listForProjection({
      ...input,
      anchor: input.anchor ?? "all",
    });
  }

  async getProjectOrganizationId(input: { projectId: string }): Promise<string> {
    const organizationId = await this.repository.findProjectOrganizationId(input);
    if (organizationId === null) {
      throw new AnnotationProjectNotFoundError(input.projectId);
    }
    return organizationId;
  }

  async assertQueueConfigurationReferences(input: {
    projectId: string;
    userIds: string[];
    scoreTypeIds: string[];
  }): Promise<void> {
    const organizationId = await this.getProjectOrganizationId(input);
    const userIds = [...new Set(input.userIds)];
    const scoreTypeIds = [...new Set(input.scoreTypeIds)];
    const [userCount, scoreCount] = await Promise.all([
      this.repository.countOrganizationUsers({ organizationId, userIds }),
      this.repository.countAnnotationScores({
        projectId: input.projectId,
        scoreTypeIds,
      }),
    ]);
    if (userCount !== userIds.length) {
      throw new AnnotationQueueMemberInvalidError();
    }
    if (scoreCount !== scoreTypeIds.length) {
      throw new AnnotationScoreInvalidError();
    }
  }

  async assertAnnotatorReferences(input: {
    projectId: string;
    queueIds: string[];
    userIds: string[];
  }): Promise<void> {
    const organizationId = await this.getProjectOrganizationId(input);
    const queueIds = [...new Set(input.queueIds)];
    const userIds = [...new Set(input.userIds)];
    const [queueCount, userCount] = await Promise.all([
      this.repository.countAnnotationQueues({
        projectId: input.projectId,
        queueIds,
      }),
      this.repository.countOrganizationUsers({ organizationId, userIds }),
    ]);
    if (queueCount !== queueIds.length || userCount !== userIds.length) {
      throw new AnnotationAnnotatorInvalidError();
    }
  }
}
