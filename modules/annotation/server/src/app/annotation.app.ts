import {
  ANNOTATION_KSUID_RESOURCE,
  AnnotationApi,
  AnnotationNotFoundError,
  AnnotationAnnotatorInvalidError,
  AnnotationAnnotatorReferenceInvalidError,
  AnnotationQueueMemberInvalidError,
  AnnotationScoreInvalidError,
  resolveAnnotationSuggestionTarget,
  withReadableAnnotationAnchor,
  type Annotation,
  type CreateAnnotationInput,
  type CreateUnattributedAnnotationInput,
  type ListProjectionAnnotationsInput,
  type UpdateAnnotationInput,
  type DeleteAnnotationInput,
  type AnnotationByIdInput,
  type ListAnnotationsInput,
  type ListAnnotationScoreNamesInput,
  type UpsertAnnotationScoreInput,
  type ListAnnotationScoresInput,
  type AnnotationScoreByIdInput,
  type ToggleAnnotationScoreInput,
  type AnnotationQueueConfiguration,
  type AnnotationQueueScope,
  type AnnotationQueueCaller,
  type QueueAnnotationTracesInput,
  type AnnotationReviewUpdateInput,
  type AnnotationReviewDeleteInput,
  type AnnotationReviewOptimizedQueuesInput,
  type AnnotationQueuePageItem,
  type AnnotationReviewQueueItem,
  type AnnotationReviewCreateInput,
  type AnnotationSuggestionSource,
} from "@langwatch/annotation-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import {
  OrganizationApi,
  UserNotInOrganizationError,
  type User as OrganizationMember,
} from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { TraceApi } from "@langwatch/trace-contract";
import { UserApi, type UserFullProfile } from "@langwatch/user-contract";
import { createLogger } from "@langwatch/observability";
import { generate } from "@langwatch/ksuid";
import { fromDate, nowInstant } from "@langwatch/time";
import { z } from "zod";
import type { AnnotationRepositories } from "#repositories/annotation.repositories";
import { AnnotationService } from "#services/annotation.service";
import { AnnotationQueueService } from "#services/annotation-queue.service";
import { AnnotationScoreService } from "#services/annotation-score.service";

/**
 * Everything the process hands this module, named one member per key: the
 * repositories the registry built and the peer applications the module reads
 * through their own tokens. There is nothing else — annotation keeps no state
 * outside its own tables and reaches nothing the process owns — so this list
 * IS the module's member set, and a member added here that the process cannot
 * supply is a compile error at the call that installs it.
 */
type AnnotationSetup = Readonly<{
  repositories: AnnotationRepositories;
  dependencies: Readonly<{
    projects: ProjectApi;
    organizations: OrganizationApi;
    traces: TraceApi;
    users: UserApi;
    permissions: AuthzApi;
  }>;
}>;
const logger = createLogger("langwatch:annotation:app");
const annotatorReferenceSchema = z.string().transform((reference, context) => {
  if (reference.startsWith("queue-") && reference.length > 6) {
    return { type: "queue" as const, id: reference.slice(6) };
  }

  if (reference.startsWith("user-") && reference.length > 5) {
    return { type: "user" as const, id: reference.slice(5) };
  }

  context.addIssue({ code: "custom", message: "Invalid annotator" });

  return z.NEVER;
});

export class AnnotationApp implements AnnotationApi {
  static readonly contract = AnnotationApi;
  static readonly dependencies = {
    projects: ProjectApi,
    organizations: OrganizationApi,
    traces: TraceApi,
    users: UserApi,
    permissions: AuthzApi,
  };

  #annotations: AnnotationService;
  #scores: AnnotationScoreService;
  #queues: AnnotationQueueService;
  #projects: ProjectApi;
  #organizations: OrganizationApi;
  #users: UserApi;
  #traces: TraceApi;
  #permissions: AuthzApi;

  private constructor(
    repositories: AnnotationRepositories,
    dependencies: AnnotationSetup["dependencies"],
  ) {
    this.#annotations = AnnotationService.create({ repository: repositories.annotations });
    this.#scores = AnnotationScoreService.create({ repository: repositories.scores });

    this.#queues = AnnotationQueueService.create({
      queues: repositories.queues,
      items: repositories.queueItems,
    });

    this.#projects = dependencies.projects;
    this.#organizations = dependencies.organizations;
    this.#users = dependencies.users;
    this.#traces = dependencies.traces;
    this.#permissions = dependencies.permissions;
  }

  static create({ repositories, dependencies }: AnnotationSetup): AnnotationApp {
    return new AnnotationApp(repositories, dependencies);
  }

  create(input: CreateAnnotationInput) {
    return this.#annotations.create(input);
  }

  createUnattributed(input: CreateUnattributedAnnotationInput) {
    return this.#annotations.createUnattributed(input);
  }

  update(input: UpdateAnnotationInput) {
    return this.#annotations.update(input);
  }

  delete(input: DeleteAnnotationInput) {
    return this.#annotations.delete(input);
  }

  getById(input: AnnotationByIdInput) {
    return this.#annotations.getById(input);
  }

  list(input: ListAnnotationsInput) {
    return this.#annotations.list(input);
  }

  listForProjection(input: ListProjectionAnnotationsInput) {
    return this.#annotations.listForProjection(input);
  }

  listScoreNames(input: ListAnnotationScoreNamesInput) {
    return this.#scores.listScoreNames(input);
  }

  upsertScore(input: UpsertAnnotationScoreInput) {
    return this.#scores.upsertScore(input);
  }

  listScores(input: ListAnnotationScoresInput) {
    return this.#scores.listScores(input);
  }

  getScore(input: AnnotationScoreByIdInput) {
    return this.#scores.getScore(input);
  }

  toggleScore(input: ToggleAnnotationScoreInput) {
    return this.#scores.toggleScore(input);
  }

  deleteScore(input: AnnotationScoreByIdInput) {
    return this.#scores.deleteScore(input);
  }

  async configure(input: AnnotationQueueConfiguration) {
    const organizationId = await this.#projects.getOrganizationId(input.projectId);
    const userIds = [...new Set(input.userIds)];
    const scoreTypeIds = [...new Set(input.scoreTypeIds)];

    const [, count] = await Promise.all([
      this.#assertOrganizationMembers(organizationId, userIds, AnnotationQueueMemberInvalidError),
      this.#scores.countAnnotationScores({ projectId: input.projectId, scoreTypeIds }),
    ]);

    if (count !== scoreTypeIds.length) throw new AnnotationScoreInvalidError();

    return this.#queues.configure(input);
  }
  listQueues(input: AnnotationQueueScope & Readonly<{ reachableOnly?: boolean; userId?: string }>) {
    return this.#queues.listQueues(input);
  }

  async getQueue(input: AnnotationQueueScope & Readonly<{ slug?: string; queueId?: string }>) {
    const { members, ...scope } = await this.#getOrganizationScope(input);
    const queue = await this.#queues.getQueue({ ...input, ...scope });

    return this.#withMemberSummaries(queue, members);
  }

  async listQueueItems(input: AnnotationQueueScope) {
    const { members, ...scope } = await this.#getOrganizationScope(input);
    const items = await this.#queues.listQueueItems({ ...input, ...scope });

    return items.map((item) => this.#withQueueItemMemberSummaries(item, members));
  }

  countPendingItems(input: AnnotationQueueCaller) {
    return this.#queues.countPendingItems(input);
  }

  countAssignedItems(input: AnnotationQueueCaller) {
    return this.#queues.countAssignedItems(input);
  }

  async listMemberQueuePendingCounts(input: AnnotationQueueCaller) {
    return [...(await this.#queues.listMemberQueuePendingCounts(input))];
  }

  async deleteQueueItems(
    input: AnnotationQueueCaller & Readonly<{ queueItemIds: readonly string[] }>,
  ) {
    const { members: _members, ...scope } = await this.#getOrganizationScope(input);

    return this.#queues.deleteQueueItems({ ...input, ...scope });
  }

  async markQueueItemDone(input: AnnotationQueueCaller & Readonly<{ queueItemId: string }>) {
    const { members: _members, ...scope } = await this.#getOrganizationScope(input);

    return this.#queues.markQueueItemDone({ ...input, ...scope });
  }

  async #getOrganizationScope({ projectId }: { projectId: string }) {
    const organizationId = await this.#projects.getOrganizationId(projectId);
    const members = await this.#organizations.getAllMembers({ organizationId });

    return {
      organizationId,
      organizationMemberIds: members.map((member) => member.id),
      members: new Map(members.map((member) => [member.id, member])),
    };
  }

  #memberSummary(
    user: { id: string; name: string | null; image: string | null },
    members: ReadonlyMap<string, OrganizationMember>,
  ) {
    const member = members.get(user.id);

    return member === void 0 ? user : { id: member.id, name: member.name, image: member.image };
  }

  #withMemberSummaries<
    T extends { members: { user: { id: string; name: string | null; image: string | null } }[] },
  >(queue: T, members: ReadonlyMap<string, OrganizationMember>): T {
    return {
      ...queue,
      members: queue.members.map(({ user }) => ({ user: this.#memberSummary(user, members) })),
    };
  }

  #withQueueItemMemberSummaries<
    T extends {
      user: { id: string; name: string | null; image: string | null } | null;
      createdByUser: { id: string; name: string | null; image: string | null } | null;
    },
  >(item: T, members: ReadonlyMap<string, OrganizationMember>): T {
    return {
      ...item,
      user: item.user === null ? null : this.#memberSummary(item.user, members),
      createdByUser:
        item.createdByUser === null ? null : this.#memberSummary(item.createdByUser, members),
    };
  }

  async #assertOrganizationMembers(
    organizationId: string,
    userIds: string[],
    InvalidMemberError:
      | typeof AnnotationQueueMemberInvalidError
      | typeof AnnotationAnnotatorInvalidError,
  ): Promise<void> {
    try {
      await this.#organizations.getOrganizationMembers({ organizationId, userIds });
    } catch (error) {
      if (error instanceof UserNotInOrganizationError) {
        throw new InvalidMemberError();
      }

      throw error;
    }
  }

  async queueTraces(input: QueueAnnotationTracesInput) {
    const annotators = input.annotators.map((reference) => {
      const result = annotatorReferenceSchema.safeParse(reference);

      if (!result.success) {
        throw new AnnotationAnnotatorReferenceInvalidError(reference);
      }

      return result.data;
    });

    const queueIds = annotators.filter((item) => item.type === "queue").map((item) => item.id);
    const userIds = annotators.filter((item) => item.type === "user").map((item) => item.id);
    const organizationId = await this.#projects.getOrganizationId(input.projectId);

    const [queueCount] = await Promise.all([
      this.#queues.countQueues({ projectId: input.projectId, queueIds: [...new Set(queueIds)] }),
      this.#assertOrganizationMembers(
        organizationId,
        [...new Set(userIds)],
        AnnotationAnnotatorInvalidError,
      ),
    ]);

    if (queueCount !== new Set(queueIds).size) throw new AnnotationAnnotatorInvalidError();

    const candidates = [...new Set(input.traceIds.map((id) => id.trim()).filter(Boolean))];

    const existing = new Set(
      await this.#traces.findExistingTraceIds({ projectId: input.projectId, traceIds: candidates }),
    );

    const traceIds = candidates.filter((id) => existing.has(id));

    await this.#queues.createQueueItems({
      projectId: input.projectId,
      traceIds,
      queueIds,
      userIds,
      createdByUserId: input.userId,
    });

    return { created: traceIds.length, skipped: input.traceIds.length - traceIds.length };
  }

  async listWithFullUsers(input: ListAnnotationsInput) {
    const annotations = await this.list(input);
    const profiles = await this.#profilesFor(annotations);

    return annotations.map((annotation) => ({
      ...annotation,
      user: annotation.userId ? (profiles.get(annotation.userId) ?? null) : null,
    }));
  }

  async listWithUserSummaries(input: ListAnnotationsInput) {
    const annotations = await this.listWithFullUsers(input);

    return annotations.map(({ user, ...annotation }) =>
      withReadableAnnotationAnchor({
        ...annotation,
        user: user ? { id: user.id, name: user.name, image: user.image } : null,
      }),
    );
  }

  async #profilesFor(annotations: readonly Annotation[]): Promise<Map<string, UserFullProfile>> {
    const userIds = [
      ...new Set(
        annotations.flatMap((annotation) =>
          annotation.userId === null ? [] : [annotation.userId],
        ),
      ),
    ];

    const profiles = await this.#users.getProfiles({ userIds });

    return new Map(profiles.map((profile) => [profile.id, profile]));
  }

  async createReview(input: AnnotationReviewCreateInput) {
    await this.#syncTraceSuggestion(input);

    const created = await this.create({
      userId: input.actorId,
      id: generate(ANNOTATION_KSUID_RESOURCE).toString(),
      projectId: input.projectId,
      traceId: input.traceId,
      comment: input.comment ?? "",
      isThumbsUp: input.isThumbsUp ?? null,
      scoreOptions: input.scoreOptions,
      expectedOutput: input.expectedOutput ?? null,
      anchorKind: input.anchorKind,
      anchorId: input.anchorId,
      anchorPath: input.anchorPath,
    });

    await this.#recordMarkerBestEffort(created);

    return created;
  }

  async updateReview(input: AnnotationReviewUpdateInput) {
    const existing = await this.getById({
      id: input.id,
      projectId: input.projectId,
    });

    if (existing.traceId !== input.traceId) {
      throw new AnnotationNotFoundError(input.id);
    }

    await this.#syncTraceSuggestion(
      {
        ...input,
        anchorKind: existing.anchorKind,
        anchorId: existing.anchorId,
        anchorPath: existing.anchorPath,
      },
      existing.expectedOutput,
    );

    return this.update({
      id: input.id,
      projectId: input.projectId,
      traceId: input.traceId,
      comment: input.comment ?? "",
      isThumbsUp: input.isThumbsUp,
      scoreOptions: input.scoreOptions,
      expectedOutput: input.expectedOutput,
    });
  }

  async deleteReview(input: AnnotationReviewDeleteInput) {
    const deleted = await this.delete({
      id: input.annotationId,
      projectId: input.projectId,
    });

    try {
      await this.#traces.removeAnnotation({
        tenantId: input.projectId,
        traceId: deleted.traceId,
        annotationId: deleted.id,
        occurredAt: nowInstant().epochMilliseconds,
      });
    } catch (error) {
      logger.error(
        { error, traceId: deleted.traceId, projectId: input.projectId },
        "Failed to sync annotation removal to ClickHouse",
      );
    }

    return deleted;
  }

  async #syncTraceSuggestion(
    input: AnnotationSuggestionSource & { actorId: string; projectId: string; traceId: string },
    previousExpectedOutput?: string | null,
  ): Promise<void> {
    if (input.expectedOutput === void 0) return;

    const next = input.expectedOutput ?? "";
    const previous = previousExpectedOutput ?? "";
    if (next === previous) return;

    const target = resolveAnnotationSuggestionTarget(input);
    if (target === null) return;

    const mayUpdate = await this.#permissions.hasProjectPermission({
      userId: input.actorId,
      projectId: input.projectId,
      permission: "annotations:update",
    });

    if (!mayUpdate) return;

    await this.#traces.writeSuggestion({
      projectId: input.projectId,
      traceId: input.traceId,
      target,
      text: next,
      userId: input.actorId,
    });
  }

  async #recordMarkerBestEffort(annotation: Annotation): Promise<void> {
    try {
      await this.#traces.recordAnnotation({
        tenantId: annotation.projectId,
        traceId: annotation.traceId,
        annotationId: annotation.id,
        occurredAt: nowInstant().epochMilliseconds,
      });
    } catch (error) {
      logger.error(
        { error, traceId: annotation.traceId, projectId: annotation.projectId },
        "Failed to sync annotation to ClickHouse",
      );
    }
  }
  async listReviewQueueItems(input: AnnotationQueueCaller) {
    const queueItems = await this.listQueueItems(input);
    const traceIds = [...new Set(queueItems.map((item) => item.traceId))];

    const traces = await this.#traces.loadTraces({
      projectId: input.projectId,
      userId: input.userId,
      traceIds,
    });

    const traceMap = new Map(traces.map((trace) => [trace.trace_id, trace]));

    return queueItems.map((item) => ({ ...item, trace: traceMap.get(item.traceId) ?? null }));
  }

  async listOptimizedQueues(input: AnnotationReviewOptimizedQueuesInput) {
    const { members, ...scope } = await this.#getOrganizationScope(input);

    const page = await this.#queues.listQueueItemsPage({
      ...scope,
      projectId: input.projectId,
      userId: input.userId,
      status: input.selectedAnnotations,
      queueId: input.queueId,
      ...(input.queueIds && input.queueIds.length > 0 ? { pickedQueueIds: input.queueIds } : {}),
      includeMemberQueues: input.showQueueAndUser === true,
      startDate: input.startDate ? fromDate(input.startDate) : void 0,
      endDate: input.endDate ? fromDate(input.endDate) : void 0,
      pageSize: input.pageSize,
      pageOffset: input.pageOffset,
      allQueueItems: input.allQueueItems === true,
    });

    const queueIds = [
      ...new Set(
        page.items.flatMap((item) =>
          item.annotationQueueId === null ? [] : [item.annotationQueueId],
        ),
      ),
    ];

    const queues = await this.#queues.listQueuesWithItems({
      projectId: input.projectId,
      ...scope,
      queueIds,
    });

    const itemsWithMembers = page.items.map((item) => {
      const withUsers = this.#withQueueItemMemberSummaries(item, members);

      return withUsers.annotationQueue === null
        ? withUsers
        : {
            ...withUsers,
            annotationQueue: this.#withMemberSummaries(withUsers.annotationQueue, members),
          };
    });

    const enrichedQueueItems = await this.#enrichQueueItems(input, itemsWithMembers);
    const enrichedById = new Map(enrichedQueueItems.map((item) => [item.id, item] as const));

    const processedQueues = queues.map((queue) => {
      const queueWithMembers = this.#withMemberSummaries(queue, members);

      return {
        ...queueWithMembers,
        AnnotationQueueItems: queueWithMembers.AnnotationQueueItems.flatMap((item) => {
          const enriched = enrichedById.get(item.id);

          return enriched === void 0 ? [] : [enriched];
        }),
      };
    });

    return {
      assignedQueueItems: enrichedQueueItems,
      queues: processedQueues,
      totalCount: page.totalCount,
    };
  }

  async #enrichQueueItems(
    input: AnnotationQueueCaller,
    queueItems: readonly AnnotationQueuePageItem[],
  ): Promise<AnnotationReviewQueueItem[]> {
    const traceIds = [...new Set(queueItems.map((item) => item.traceId))];

    const annotationsWithUsers = await this.listWithFullUsers({
      projectId: input.projectId,
      traceIds,
      anchor: "all",
      order: "desc",
    });

    const traces = await this.#traces.loadTraces({
      projectId: input.projectId,
      userId: input.userId,
      traceIds,
    });

    const traceMap = new Map(traces.map((trace) => [trace.trace_id, trace]));
    const annotationMap = Map.groupBy(annotationsWithUsers, (annotation) => annotation.traceId);

    return queueItems.map((item) => {
      const annotations = annotationMap.get(item.traceId) ?? [];

      return {
        ...item,
        trace: traceMap.get(item.traceId) ?? null,
        annotations,
        scoreOptions: annotations.flatMap((annotation) =>
          annotation.scoreOptions ? Object.keys(annotation.scoreOptions) : [],
        ),
      };
    });
  }
}
