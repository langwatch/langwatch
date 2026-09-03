import {
  AnnotationAnnotatorInvalidError,
  AnnotationProjectNotFoundError,
  AnnotationQueueMemberInvalidError,
  AnnotationScoreInvalidError,
  AnnotationService as AnnotationServiceContract,
  annotationByIdInputSchema,
  annotationProjectInputSchema,
  annotationScoreByIdInputSchema,
  assertAnnotatorReferencesInputSchema,
  assertQueueConfigurationReferencesInputSchema,
  createAnnotationInputSchema,
  createAnnotationQueueItemsInputSchema,
  deleteAnnotationInputSchema,
  listAnnotationScoreNamesInputSchema,
  listAnnotationScoresInputSchema,
  listAnnotationsInputSchema,
  listProjectionAnnotationsInputSchema,
  toggleAnnotationScoreInputSchema,
  updateAnnotationInputSchema,
  upsertAnnotationScoreInputSchema,
  type Annotation,
  type AnnotationByIdInput,
  type AnnotationProjectInput,
  type AnnotationScore,
  type AnnotationScoreByIdInput,
  type AnnotationScoreName,
  type AssertAnnotatorReferencesInput,
  type AssertQueueConfigurationReferencesInput,
  type CreateAnnotationInput,
  type CreateAnnotationQueueItemsInput,
  type DeleteAnnotationInput,
  type ListAnnotationScoreNamesInput,
  type ListAnnotationScoresInput,
  type ListAnnotationsInput,
  type ListProjectionAnnotationsInput,
  type ProjectionAnnotation,
  type ToggleAnnotationScoreInput,
  type UpdateAnnotationInput,
  type UpsertAnnotationScoreInput,
} from "@langwatch/annotation-contract";
import { OrganizationService, UserNotInOrganizationError } from "@langwatch/organization-contract";
import { ProjectNotFoundError, ProjectService } from "@langwatch/project-contract";
import { AnnotationRepository } from "../ports/annotation.port";

export class AnnotationService extends AnnotationServiceContract {
  private constructor(
    private readonly repository: AnnotationRepository,
    private readonly projects: ProjectService,
    private readonly organizations: OrganizationService,
  ) {
    super();
  }

  static create(options: {
    repository: AnnotationRepository;
    projects: ProjectService;
    organizations: OrganizationService;
  }): AnnotationService {
    return new AnnotationService(options.repository, options.projects, options.organizations);
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

  getById(input: AnnotationByIdInput): Promise<Annotation> {
    const parsed = annotationByIdInputSchema.parse(input);
    return this.repository.getById(parsed);
  }

  list(input: ListAnnotationsInput): Promise<Annotation[]> {
    return this.repository.list(listAnnotationsInputSchema.parse(input));
  }

  listForProjection(input: ListProjectionAnnotationsInput): Promise<ProjectionAnnotation[]> {
    return this.repository.listForProjection(listProjectionAnnotationsInputSchema.parse(input));
  }

  listScoreNames(input: ListAnnotationScoreNamesInput): Promise<AnnotationScoreName[]> {
    const parsed = listAnnotationScoreNamesInputSchema.parse(input);
    return this.repository.listScoreNames(parsed);
  }

  upsertScore(input: UpsertAnnotationScoreInput): Promise<AnnotationScore> {
    const parsed = upsertAnnotationScoreInputSchema.parse(input);
    return this.repository.upsertScore(parsed);
  }

  listScores(input: ListAnnotationScoresInput): Promise<AnnotationScore[]> {
    const parsed = listAnnotationScoresInputSchema.parse(input);
    return this.repository.listScores(parsed);
  }

  getScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore> {
    const parsed = annotationScoreByIdInputSchema.parse(input);
    return this.repository.getScore(parsed);
  }

  toggleScore(input: ToggleAnnotationScoreInput): Promise<AnnotationScore> {
    const parsed = toggleAnnotationScoreInputSchema.parse(input);
    return this.repository.toggleScore(parsed);
  }

  deleteScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore> {
    const parsed = annotationScoreByIdInputSchema.parse(input);
    return this.repository.deleteScore(parsed);
  }

  createQueueItems(input: CreateAnnotationQueueItemsInput): Promise<void> {
    return this.repository.createQueueItems(createAnnotationQueueItemsInputSchema.parse(input));
  }

  async getProjectOrganizationId(input: AnnotationProjectInput): Promise<string> {
    const parsed = annotationProjectInputSchema.parse(input);
    try {
      return await this.projects.getOrganizationId(parsed.projectId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new AnnotationProjectNotFoundError(parsed.projectId);
      }
      throw error;
    }
  }

  async assertQueueConfigurationReferences(
    input: AssertQueueConfigurationReferencesInput,
  ): Promise<void> {
    const parsed = assertQueueConfigurationReferencesInputSchema.parse(input);
    const organizationId = await this.getProjectOrganizationId({
      projectId: parsed.projectId,
    });
    const userIds = [...new Set(parsed.userIds)];
    const scoreTypeIds = [...new Set(parsed.scoreTypeIds)];
    const [, scoreCount] = await Promise.all([
      this.assertOrganizationMembers(organizationId, userIds, AnnotationQueueMemberInvalidError),
      this.repository.countAnnotationScores({
        projectId: parsed.projectId,
        scoreTypeIds,
      }),
    ]);
    if (scoreCount !== scoreTypeIds.length) throw new AnnotationScoreInvalidError();
  }

  async assertAnnotatorReferences(input: AssertAnnotatorReferencesInput): Promise<void> {
    const parsed = assertAnnotatorReferencesInputSchema.parse(input);
    const organizationId = await this.getProjectOrganizationId({
      projectId: parsed.projectId,
    });
    const queueIds = [...new Set(parsed.queueIds)];
    const userIds = [...new Set(parsed.userIds)];
    const queueCountPromise = this.repository.countAnnotationQueues({
      projectId: parsed.projectId,
      queueIds,
    });
    const [queueCount] = await Promise.all([
      queueCountPromise,
      this.assertOrganizationMembers(organizationId, userIds, AnnotationAnnotatorInvalidError),
    ]);
    if (queueCount !== queueIds.length) {
      throw new AnnotationAnnotatorInvalidError();
    }
  }

  private async assertOrganizationMembers(
    organizationId: string,
    userIds: string[],
    InvalidMemberError:
      | typeof AnnotationQueueMemberInvalidError
      | typeof AnnotationAnnotatorInvalidError,
  ): Promise<void> {
    try {
      await this.organizations.getOrganizationMembers({ organizationId, userIds });
    } catch (error) {
      if (error instanceof UserNotInOrganizationError) throw new InvalidMemberError();
      throw error;
    }
  }
}
